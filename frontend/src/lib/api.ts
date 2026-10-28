import axios from "axios";

const defaultBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const serverBaseUrl = typeof window === "undefined" ? defaultBaseUrl.replace("localhost", "127.0.0.1") : defaultBaseUrl;

export const api = axios.create({
  baseURL: serverBaseUrl,
  withCredentials: true, // Send cookies with every request
  timeout: 10000, // 10 second timeout to prevent hanging UI (increased for dev)
  headers: {
    "Content-Type": "application/json",
  },
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Share freshly minted access tokens across tabs so background tabs with an
// expired session can recover from a peer's refresh instead of logging out.
// Only created in the browser; BroadcastChannel only reaches same-origin tabs.
const refreshChannel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("session-refresh")
    : null;

function waitForPeerToken(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = refreshChannel;
    if (!channel) return resolve(null);
    let finished = false;
    const finish = (token: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "access-token" && typeof event.data.token === "string") {
        finish(event.data.token);
      }
    };
    channel.addEventListener("message", onMessage);
  });
}

api.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("accessToken");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }

    // For FormData uploads, delete application/json Content-Type so Axios/browser
    // sets multipart/form-data with the correct boundary string.
    const isFormData = typeof FormData !== "undefined" && config.data instanceof FormData;
    if (isFormData && config.headers) {
      delete config.headers["Content-Type"];
      delete config.headers["content-type"];
    }

    // Automatically elevate timeout for file uploads and multipart requests to 120s
    // to prevent timeout of 10000ms exceeded on large images / Cloudinary streams
    const isUploadEndpoint = Boolean(config.url && config.url.includes("/upload"));
    if ((isFormData || isUploadEndpoint) && (!config.timeout || config.timeout === 10000)) {
      config.timeout = 120000;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      const isAuthUrl = 
        originalRequest.url?.includes("/auth/login") || 
        originalRequest.url?.includes("/auth/refresh");
      
      const hasToken = typeof window !== "undefined" && !!localStorage.getItem("accessToken");

      // Skip refresh attempt if calling login/refresh or if checking /auth/me without token
      if (isAuthUrl || (originalRequest.url?.includes("/auth/me") && !hasToken)) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          {},
          { withCredentials: true }
        );

        const newAccessToken = data.data.accessToken;
        localStorage.setItem("accessToken", newAccessToken);

        api.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;

        refreshChannel?.postMessage({ type: "access-token", token: newAccessToken });

        processQueue(null, newAccessToken);
        return api(originalRequest);
      } catch (refreshError) {
        // Another tab may have just minted a fresh token for this session (same cookie
        // jar). Give it a moment to broadcast before declaring the session dead.
        const peerToken = await waitForPeerToken(1500);
        if (peerToken) {
          localStorage.setItem("accessToken", peerToken);
          api.defaults.headers.common.Authorization = `Bearer ${peerToken}`;
          originalRequest.headers.Authorization = `Bearer ${peerToken}`;
          processQueue(null, peerToken);
          return api(originalRequest);
        }

        processQueue(refreshError, null);
        localStorage.removeItem("accessToken");
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("auth-expired"));
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
