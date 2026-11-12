import { rateLimit, ipKeyGenerator } from "express-rate-limit";

const rateLimitResponse = (message: string) => ({
  success: false,
  message,
  code: "RATE_LIMIT_EXCEEDED",
  errors: [],
});

const normalizeEmailKey = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

// Login brute-force protection: 10 attempts / 15 min / IP.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
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

// Registration abuse protection: 5 accounts / hour / IP.
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse(
    "Too many accounts created from this network, please try again later."
  ),
});

// Rate limit for sensitive order creation (20 req / 15 min)
export const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Too many order creation requests, please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
    errors: [],
  },
});

// Rate limit for payment initialization & verification (30 req / 15 min)
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: "Too many payment operations, please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
    errors: [],
  },
});

// Rate limit for admin refunds (15 req / 15 min)
export const refundLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: {
    success: false,
    message: "Too many refund operations requested, please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
    errors: [],
  },
});

// Rate limit for return submissions and workflow updates (20 req / 15 min)
export const returnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    message: "Too many return operations, please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
    errors: [],
  },
});

// Rate limit for stock adjustments (30 req / 15 min)
export const inventoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    success: false,
    message: "Too many inventory adjustment operations, please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
    errors: [],
  },
});

// Rate limit for public order tracking lookups (60 req / 15 min per IP)
export const trackOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many tracking requests from this network, please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
    errors: [],
  },
});
