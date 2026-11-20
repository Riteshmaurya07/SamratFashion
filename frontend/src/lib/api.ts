import axios from "axios";

export function normalizeApiBaseUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return /\/api$/i.test(normalizedBaseUrl)
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/api`;
}

const defaultBaseUrl = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api"
);
const serverBaseUrl = typeof window === "undefined" ? defaultBaseUrl.replace("localhost", "127.0.0.1") : defaultBaseUrl;

export const api = axios.create({
  baseURL: serverBaseUrl,
  withCredentials: true, // Send httpOnly cookies (accessToken and refreshToken) with every request
  timeout: 25000, // 25 second timeout to accommodate cold-start backend latency
  headers: {
    "Content-Type": "application/json",
  },
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

const processQueue = (error: unknown) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

// H3: Tab broadcast carries only a "session-refreshed" signal, NEVER token material.
const refreshChannel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("session-refresh")
    : null;

function waitForPeerRefresh(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = refreshChannel;
    if (!channel) return resolve(false);
    let finished = false;
    const finish = (refreshed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      resolve(refreshed);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "session-refreshed") {
        finish(true);
      }
    };
    channel.addEventListener("message", onMessage);
  });
}

api.interceptors.request.use(
  (config) => {
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
    if ((isFormData || isUploadEndpoint) && (!config.timeout || config.timeout <= 25000)) {
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
        originalRequest.url?.includes("/auth/refresh") ||
        originalRequest.url?.includes("/auth/register");

      if (isAuthUrl) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => {
            originalRequest._retry = true;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        if (typeof navigator !== "undefined" && navigator.locks) {
          let alreadyRefreshed = false;
          let retryResponse: unknown = null;

          await navigator.locks.request("session-refresh-lock", async () => {
            // Check if another peer tab refreshed while we waited for the lock
            try {
              originalRequest._retry = true;
              retryResponse = await axios(originalRequest);
              alreadyRefreshed = true;
              processQueue(null);
            } catch {
              // Still 401, perform authoritative refresh
              await axios.post(
                `${api.defaults.baseURL}/auth/refresh`,
                {},
                { withCredentials: true }
              );
              refreshChannel?.postMessage({ type: "session-refreshed" });
              processQueue(null);
            }
          });

          if (alreadyRefreshed && retryResponse) {
            return retryResponse;
          }
        } else {
          await axios.post(
            `${api.defaults.baseURL}/auth/refresh`,
            {},
            { withCredentials: true }
          );
          refreshChannel?.postMessage({ type: "session-refreshed" });
          processQueue(null);
        }

        return api(originalRequest);
      } catch (refreshError) {
        // Another tab may have just refreshed the session cookies.
        // Wait for peer signal before declaring session dead.
        const peerRefreshed = await waitForPeerRefresh(1500);
        if (peerRefreshed) {
          processQueue(null);
          return api(originalRequest);
        }

        processQueue(refreshError);
        const skipExpired = originalRequest.headers?.["x-skip-auth-expired"] === "true";
        if (typeof window !== "undefined" && !skipExpired) {
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
