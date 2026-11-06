"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (notification?: (notification: unknown) => void) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number;
            }
          ) => void;
        };
      };
    };
  }
}

type GoogleCredentialResponse = { credential: string };

let initializedGoogleClientId: string | null = null;
let activeGoogleCredentialHandler: ((response: GoogleCredentialResponse) => void) | null = null;

interface GoogleAuthButtonProps {
  label?: string;
  redirectTo?: string;
  onError?: (error: string) => void;
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.04 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function extractErrorMessage(err: unknown, defaultMsg: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = err.response;
    if (response && typeof response === "object" && "data" in response) {
      const data = response.data;
      if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
        return data.message;
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return defaultMsg;
}

export function GoogleAuthButton({
  label = "Continue with Google",
  redirectTo = "/account",
  onError,
}: GoogleAuthButtonProps) {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isGsiRendered, setIsGsiRendered] = useState(false);
  const [showDevModal, setShowDevModal] = useState(false);
  const [devEmail, setDevEmail] = useState("");
  const [devName, setDevName] = useState("");

  const googleBtnContainer = useRef<HTMLDivElement>(null);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const onErrorRef = useRef(onError);

  const handleAuthSuccess = useCallback(
    async (payload: { credential?: string; mockUser?: { email: string; name: string; avatar?: string } }) => {
      try {
        setIsLoading(true);
        const response = await api.post("/auth/google", payload);

        if (response.data.success) {
          if (response.data.data?.accessToken) {
            localStorage.setItem("accessToken", response.data.data.accessToken);
          }
          if (response.data.data?.user) {
            setUser(response.data.data.user);
          }
          router.push(redirectTo);
        }
      } catch (err: unknown) {
        const errorMsg = extractErrorMessage(err, "Google sign-in failed. Please try again.");
        onErrorRef.current?.(errorMsg);
      } finally {
        setIsLoading(false);
        setShowDevModal(false);
      }
    },
    [router, redirectTo, setUser]
  );
  const handleAuthSuccessRef = useRef(handleAuthSuccess);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    handleAuthSuccessRef.current = handleAuthSuccess;
  }, [handleAuthSuccess]);

  // Render Google Identity Services native button (avoids FedCM prompt abortion)
  useEffect(() => {
    if (!googleClientId) return;

    const scriptId = "google-gis-client";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    const credentialHandler = (response: GoogleCredentialResponse) => {
      if (response.credential) {
        void handleAuthSuccessRef.current({ credential: response.credential });
      }
    };

    const initAndRender = () => {
      if (window.google?.accounts?.id && googleBtnContainer.current) {
        try {
          activeGoogleCredentialHandler = credentialHandler;
          if (initializedGoogleClientId !== googleClientId) {
            window.google.accounts.id.initialize({
              client_id: googleClientId,
              callback: (response) => activeGoogleCredentialHandler?.(response),
            });
            initializedGoogleClientId = googleClientId;
          }

          const width = Math.min(googleBtnContainer.current.parentElement?.offsetWidth || 380, 400);

          googleBtnContainer.current.replaceChildren();
          window.google.accounts.id.renderButton(googleBtnContainer.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: label.toLowerCase().includes("sign up") ? "signup_with" : "continue_with",
            shape: "rectangular",
            width: width > 200 ? width : 380,
          });
          setIsGsiRendered(true);
        } catch (renderErr) {
          console.warn("[GoogleAuthButton] GSI renderButton fallback:", renderErr);
          setIsGsiRendered(false);
        }
      }
    };

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
      script.addEventListener("load", initAndRender);
    } else if (window.google?.accounts?.id) {
      initAndRender();
    } else {
      script.addEventListener("load", initAndRender);
    }

    return () => {
      script?.removeEventListener("load", initAndRender);
      if (activeGoogleCredentialHandler === credentialHandler) {
        activeGoogleCredentialHandler = null;
      }
    };
  }, [googleClientId, label]);

  const handleDevSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!devEmail.trim()) return;

    handleAuthSuccess({
      mockUser: {
        email: devEmail.trim().toLowerCase(),
        name: devName.trim() || devEmail.split("@")[0],
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(devName || devEmail)}`,
      },
    });
  };

  return (
    <>
      <div className="w-full flex justify-center min-h-[44px]">
        {/* Native GSI Rendered Button Container (FedCM-safe) */}
        <div
          ref={googleBtnContainer}
          className={clsx("w-full flex justify-center", !isGsiRendered && "hidden")}
        />

        {/* Fallback button when Google script is loading or for dev modal */}
        {!isGsiRendered && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowDevModal(true)}
            disabled={isLoading}
            className="w-full h-11 border-outline-variant/60 hover:bg-surface-container font-medium text-sm flex items-center justify-center gap-2.5 transition-colors"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
            <span>{label}</span>
          </Button>
        )}
      </div>

      {/* Dev Mode Modal for Testing without requiring live Google Cloud Console credentials */}
      {showDevModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <GoogleIcon />
                <h3 className="text-base font-bold text-on-surface">Continue with Google</h3>
              </div>
              <p className="text-xs text-on-surface-variant font-mono">
                {googleClientId ? "Google Sign-In test bypass" : "Local Development Mode (NEXT_PUBLIC_GOOGLE_CLIENT_ID not set)"}
              </p>
            </div>

            <div
              className="space-y-3"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleDevSubmit();
                }
              }}
            >
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="dev-email">
                  Google Account Email
                </label>
                <input
                  id="dev-email"
                  type="email"
                  value={devEmail}
                  onChange={(e) => setDevEmail(e.target.value)}
                  placeholder="user@gmail.com"
                  required
                  autoFocus
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="dev-name">
                  Profile Name
                </label>
                <input
                  id="dev-name"
                  type="text"
                  value={devName}
                  onChange={(e) => setDevName(e.target.value)}
                  placeholder="John Doe"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDevModal(false)}
                  className="flex-1 h-9 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => handleDevSubmit()}
                  disabled={isLoading || !devEmail}
                  className="flex-1 h-9 text-xs"
                >
                  {isLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Sign In
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
