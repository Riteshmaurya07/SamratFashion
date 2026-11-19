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
  passwordResetLimiter,
  refreshLimiter,
  logoutLimiter,
} from "../middleware/rateLimiters";
import { AppError } from "../utils/AppError";

const router = Router();

// CSRF guard for cookie-authenticated endpoints. These requests carry the httpOnly
// refresh and access tokens automatically, so cross-site HTML forms could otherwise forge them.
// L8: Reject missing Origin on cookie-authenticated POSTs in production.
const cookieOriginGuard = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const isProd = process.env.NODE_ENV === "production";

  if (!origin) {
    if (isProd) {
      return next(new AppError("Missing origin header on cookie-authenticated request", 403, "FORBIDDEN"));
    }
    if (!referer) {
      return next();
    }
  }

  const candidate = (origin || referer || "").replace(/\/+$/, "").toLowerCase();
  if (!candidate) {
    if (isProd) {
      return next(new AppError("Invalid origin header", 403, "FORBIDDEN"));
    }
    return next();
  }

  const allowed = [
    (process.env.FRONTEND_URL || "").replace(/\/+$/, "").toLowerCase(),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/+$/, "").toLowerCase()) : []),
  ].filter(Boolean);

  if (allowed.includes(candidate)) {
    return next();
  }
  return next(new AppError("Cross-origin request blocked", 403, "FORBIDDEN"));
};

router.post("/register", registerLimiter, requireTurnstile("register"), register);
router.post(
  "/login",
  loginLimiter,
  loginAccountLimiter,
  login
);
router.post("/refresh", refreshLimiter, cookieOriginGuard, refresh);
router.post("/logout", logoutLimiter, cookieOriginGuard, logout);
router.get("/me", requireAuth, me);
router.post(
  "/forgot-password",
  passwordResetLimiter,
  requireTurnstile("forgot_password"),
  forgotPassword
);
router.post("/reset-password", passwordResetLimiter, resetPassword);
router.post("/verify-email", verifyLimiter, verifyEmail);
router.post("/resend-verification", verifyLimiter, resendVerification);
router.post("/google", loginLimiter, googleAuth);

export default router;