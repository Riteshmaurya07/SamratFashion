import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { getRateLimitStore } from "./rateLimitStore";

const rateLimitResponse = (message: string) => ({
  success: false,
  message,
  code: "RATE_LIMIT_EXCEEDED",
  errors: [],
});

const normalizeEmailKey = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

// Login brute-force protection: 10 attempts / 15 min / IP (fail-closed on store error).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("login_ip", true),
  message: rateLimitResponse("Too many login attempts, please try again later."),
});

// Credential-stuffing protection: caps failed attempts per account so an
// attacker cannot rotate IPs to brute-force a single email indefinitely.
// Successful logins are not counted, so normal usage never triggers this.
export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("login_account", true),
  keyGenerator: (req) => {
    const email = normalizeEmailKey((req.body as Record<string, unknown> | undefined)?.email);
    if (email) {
      return `login:account:${email}`;
    }
    return `login:ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: rateLimitResponse(
    "Too many failed login attempts for this account, please try again later."
  ),
});

// Registration abuse protection: 5 accounts / hour / IP (fail-closed).
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("register_ip", true),
  message: rateLimitResponse(
    "Too many accounts created from this network, please try again later."
  ),
});

// Email verification OTP attempts: 15 attempts / 15 min per IP (fail-closed)
export const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("verify_ip", true),
  message: rateLimitResponse("Too many verification attempts, please try again later."),
});

// Per-account email verification attempt cap: 5 failed attempts / 15 min (fail-closed)
export const verifyAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("verify_account", true),
  keyGenerator: (req) => {
    const email = normalizeEmailKey((req.body as Record<string, unknown> | undefined)?.email);
    if (email) {
      return `verify:account:${email}`;
    }
    return `verify:ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
  message: rateLimitResponse(
    "Too many failed verification attempts for this account, please try again later."
  ),
});

// Password reset requests: 3 per hour per IP (fail-closed)
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("password_forgot_ip", true),
  message: rateLimitResponse("Too many password reset requests, please try again later."),
});

// Password reset token submission: 10 per hour per IP (fail-closed)
export const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("password_reset_ip", true),
  message: rateLimitResponse("Too many password reset attempts, please try again later."),
});

// Backward-compatible alias
export const passwordResetLimiter = forgotPasswordLimiter;

// Refresh limiter: 240 / hour / IP (fail-closed)
export const refreshLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("refresh_ip", true),
  message: rateLimitResponse("Too many refresh attempts, please try again later."),
});

// Logout limiter: 30 / 15 min / IP
export const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("logout_ip"),
  message: rateLimitResponse("Too many logout attempts, please try again later."),
});

// L3: Global rate limit for API endpoints (~300 requests / 15 min / IP)
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("global_api"),
  message: rateLimitResponse("Too many requests from this network, please try again later."),
});

// L3: Strict rate limiter for AI generation endpoint (/api/ai/generate: 10 requests / 15 min / IP)
export const aiGenerationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("ai_generate"),
  message: rateLimitResponse("Too many AI generation requests, please try again later."),
});

// Rate limit for sensitive order creation (20 req / 15 min) with shared store
export const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("order_create"),
  message: rateLimitResponse("Too many order creation requests, please try again later."),
});

// Rate limit for payment initialization & verification (30 req / 15 min) with shared store
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("payment_op"),
  message: rateLimitResponse("Too many payment operations, please try again later."),
});

// Rate limit for admin refunds (15 req / 15 min) with shared store
export const refundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("refund_op"),
  message: rateLimitResponse("Too many refund operations requested, please try again later."),
});

// Rate limit for return submissions and workflow updates (20 req / 15 min) with shared store
export const returnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("return_op"),
  message: rateLimitResponse("Too many return operations, please try again later."),
});

// Rate limit for stock adjustments (30 req / 15 min) with shared store
export const inventoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("inventory_op"),
  message: rateLimitResponse("Too many inventory adjustment operations, please try again later."),
});

// Rate limit for public order tracking lookups (60 req / 15 min per IP)
export const trackOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("track_order"),
  message: rateLimitResponse("Too many tracking requests from this network, please try again later."),
});
