"use client";

import { useEffect, useRef } from "react";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
  appearance?: "always" | "execute" | "interaction-only";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "error-callback"?: (errorCode?: string) => void;
  "refresh-expired"?: "auto" | "manual" | "never";
  retry?: "auto" | "never";
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

/**
 * Warm the TLS connection to Cloudflare before downloading the widget script.
 * This removes a DNS + TLS round-trip from the critical path, which is the
 * main source of the "CAPTCHA is slow" feeling on the auth pages.
 */
function addResourceHint(rel: "preconnect" | "dns-prefetch"): void {
  const selector = `link[data-turnstile-hint="${rel}"]`;
  if (document.querySelector(selector)) return;

  const link = document.createElement("link");
  link.rel = rel;
  link.href = TURNSTILE_ORIGIN;
  link.dataset.turnstileHint = rel;
  document.head.appendChild(link);
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  addResourceHint("preconnect");
  addResourceHint("dns-prefetch");

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile-script="true"]'
    );

    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load the Turnstile script")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = "true";
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error("Failed to load the Turnstile script")),
      { once: true }
    );
    document.head.appendChild(script);
  });

  scriptPromise = promise;
  // Allow a later attempt if the network request failed.
  promise.catch(() => {
    if (scriptPromise === promise) scriptPromise = null;
  });
  return promise;
}

interface TurnstileWidgetProps {
  /** Action name checked by the backend (register, forgot_password). */
  action: string;
  onToken: (token: string) => void;
  onExpire?: () => void;
  onError?: (message: string) => void;
  /**
   * Increment this value after a failed auth request. Turnstile tokens are
   * single-use, so the existing widget is reset in place to mint a fresh one.
   */
  resetKey?: number;
  className?: string;
  /**
   * "always" keeps the widget visible so users can see the human check and
   * developers can tell immediately if it failed to render.
   */
  appearance?: "always" | "execute" | "interaction-only";
}

export function TurnstileWidget({
  action,
  onToken,
  onExpire,
  onError,
  resetKey = 0,
  className,
  appearance = "always",
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const lastResetKeyRef = useRef(resetKey);
  const callbacksRef = useRef({ onToken, onExpire, onError });

  // Keep the latest callbacks without re-rendering the widget. Re-rendering
  // the widget would discard a valid token, so callbacks are synced in an
  // effect rather than during render.
  useEffect(() => {
    callbacksRef.current = { onToken, onExpire, onError };
  }, [onToken, onExpire, onError]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Render the widget once per action/site key. It is intentionally NOT tied
  // to resetKey: remove()+render() into the same container is unreliable and
  // requires a full page refresh to recover.
  useEffect(() => {
    if (!siteKey) return;

    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        const container = containerRef.current;
        if (cancelled || !container || !window.turnstile) return;
        if (widgetIdRef.current) return;

        if (process.env.NODE_ENV !== "production") {
          console.info(
            `[TURNSTILE] Rendering widget (hostname=${window.location.hostname}, action=${action}). ` +
              "If it stays blank, add this hostname in Cloudflare Turnstile → your widget → Hostnames."
          );
        }

        try {
          widgetIdRef.current = window.turnstile.render(container, {
            sitekey: siteKey,
            action,
            theme: "auto",
            appearance,
            callback: (token) => callbacksRef.current.onToken(token),
            "expired-callback": () => callbacksRef.current.onExpire?.(),
            "timeout-callback": () => callbacksRef.current.onExpire?.(),
            // Turnstile retries automatically; clearing the token lets the
            // form wait for the next callback instead of sending a dead one.
            "error-callback": (errorCode) => {
              console.warn("[TURNSTILE] widget error:", errorCode);
              callbacksRef.current.onExpire?.();
            },
          });
        } catch {
          callbacksRef.current.onError?.(
            "Could not start CAPTCHA verification. Please try again."
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          console.error(
            "[TURNSTILE] Script failed to load. Check network/adblock/tracking protection."
          );
          callbacksRef.current.onError?.(
            "Could not load CAPTCHA verification. Please check your connection and try again."
          );
        }
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Widget may already have been torn down by the page transition.
        }
        widgetIdRef.current = null;
      }
    };
  }, [action, siteKey, appearance]);

  // Retry path: reset the existing widget in place. This is near-instant
  // compared with remove()+render(), needs no network re-download, and
  // reliably produces a fresh single-use token.
  useEffect(() => {
    if (!siteKey) return;
    if (lastResetKeyRef.current === resetKey) return;
    lastResetKeyRef.current = resetKey;

    const widgetId = widgetIdRef.current;
    if (widgetId && window.turnstile) {
      try {
        window.turnstile.reset(widgetId);
      } catch {
        // The widget will retry on its own; the next token arrives via callback.
      }
    }
  }, [resetKey, siteKey]);

  // If no site key is configured, CAPTCHA is disabled (local development).
  if (!siteKey) return null;

  return <div ref={containerRef} className={className} />;
}
