import { rateLimit } from "express-rate-limit";

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
