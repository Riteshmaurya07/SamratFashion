import { Request, Response, NextFunction } from "express";
import { Router } from "express";
import {
  register,
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  googleAuth,
} from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { requireTurnstile } from "../middleware/turnstile";
import {
  loginLimiter,
  loginAccountLimiter,
  registerLimiter,
  verifyLimiter,
  verifyAccountLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  refreshLimiter,
  logoutLimiter,
} from "../middleware/rateLimiters";
import { AppError } from "../utils/AppError";
import { isStrictProductionOrStaging } from "../config/env";

const router = Router();

// CSRF guard for cookie-authenticated endpoints (N-M4)
// Requires a matching Origin/Referer header and removes localhost from prod allowlist
const cookieOriginGuard = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const isStrict = isStrictProductionOrStaging();

  if (!origin) {
    if (isStrict) {
      return next(new AppError("Missing origin header on cookie-authenticated request", 403, "FORBIDDEN"));
    }
    if (!referer) {
      return next();
    }
  }

  const candidate = (origin || referer || "").replace(/\/+$/, "").toLowerCase();
  if (!candidate) {
    if (isStrict) {
      return next(new AppError("Invalid origin header", 403, "FORBIDDEN"));
    }
    return next();
  }

  const allowed = [
    (process.env.FRONTEND_URL || "").replace(/\/+$/, "").toLowerCase(),
    ...(isStrict ? [] : ["http://localhost:3000", "http://127.0.0.1:3000"]),
    ...(process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/+$/, "").toLowerCase())
      : []),
  ].filter(Boolean);

  if (allowed.includes(candidate)) {
    return next();
  }
  return next(new AppError("Cross-origin request blocked", 403, "FORBIDDEN"));
};

router.post("/register", cookieOriginGuard, registerLimiter, requireTurnstile("register"), register);
router.post(
  "/login",
  cookieOriginGuard,
  loginLimiter,
  loginAccountLimiter,
  requireTurnstile("login"),
  login
);
router.post("/refresh", cookieOriginGuard, refreshLimiter, refresh);
router.post("/logout", cookieOriginGuard, logoutLimiter, logout);
router.get("/me", requireAuth, me);
router.post(
  "/forgot-password",
  cookieOriginGuard,
  forgotPasswordLimiter,
  requireTurnstile("forgot_password"),
  forgotPassword
);
router.post(
  "/reset-password",
  cookieOriginGuard,
  resetPasswordLimiter,
  requireTurnstile("reset_password"),
  resetPassword
);
router.post(
  "/verify-email",
  cookieOriginGuard,
  verifyLimiter,
  verifyAccountLimiter,
  requireTurnstile("verify_email", { skipIf: (req) => Boolean(req.body?.token) }),
  verifyEmail
);
router.post(
  "/resend-verification",
  cookieOriginGuard,
  verifyLimiter,
  verifyAccountLimiter,
  requireTurnstile("resend_verification"),
  resendVerification
);
router.post(
  "/google",
  cookieOriginGuard,
  loginLimiter,
  requireTurnstile("google", { skipIf: (req) => Boolean(req.body?.credential) }),
  googleAuth
);

export default router;