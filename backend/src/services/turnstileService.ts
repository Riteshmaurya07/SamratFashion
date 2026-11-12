/**
 * Cloudflare Turnstile server-side verification.
 *
 * The browser obtains a short-lived, single-use token from the Turnstile
 * widget. The token MUST be verified here, against Cloudflare, before any
 * auth action is allowed. Never trust a client-side "success" flag.
 *
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

export function isTurnstileEnabled(): boolean {
  return process.env.TURNSTILE_ENABLED === "true";
}

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  "error-codes"?: string[];
}

/**
 * Verify a Turnstile token with Cloudflare.
 *
 * Fails closed by default (returns false) on network/API errors so an outage
 * cannot silently disable bot protection. Set TURNSTILE_FAIL_OPEN=true only
 * as an emergency availability escape hatch.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  options: { remoteIp?: string; expectedAction?: string } = {}
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[TURNSTILE] TURNSTILE_SECRET_KEY is not configured; rejecting verification.");
    return false;
  }
  if (!token || typeof token !== "string") {
    return false;
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (options.remoteIp) {
    body.set("remoteip", options.remoteIp);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[TURNSTILE] Siteverify returned HTTP ${response.status}`);
      return process.env.TURNSTILE_FAIL_OPEN === "true";
    }

    const data = (await response.json()) as SiteverifyResponse;

    if (!data.success) {
      console.warn(
        `[TURNSTILE] Verification rejected: ${(data["error-codes"] || []).join(", ") || "unknown reason"}`
      );
      return false;
    }

    // Optional defence-in-depth: reject a token minted for a different form
    // if Cloudflare returned the action. Tokens are single-use anyway.
    if (options.expectedAction && data.action && data.action !== options.expectedAction) {
      console.warn(
        `[TURNSTILE] Action mismatch: expected ${options.expectedAction}, got ${data.action}`
      );
      return false;
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[TURNSTILE] Verification request failed: ${message}`);
    return process.env.TURNSTILE_FAIL_OPEN === "true";
  } finally {
    clearTimeout(timeout);
  }
}
