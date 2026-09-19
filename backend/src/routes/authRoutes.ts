import { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { register, login, refresh, logout, me, forgotPassword, resetPassword } from "../controllers/authController";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../utils/AppError";

const router = Router();

// Rate limiting configurations
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs for auth routes
  message: { success: false, message: "Too many attempts, please try again later.", code: "RATE_LIMIT_EXCEEDED", errors: [] }
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 requests per hour
  message: { success: false, message: "Too many password reset requests, please try again later.", code: "RATE_LIMIT_EXCEEDED", errors: [] }
});

// Refresh + logout endpoints. Tighter than unauthenticated routes so a compromised
// cookie can't be brute-forced or replayed past reasonable multi-tab usage.
const refreshLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 240, // 240 refreshes / hour / IP (way above 4/hr for a 15 min access token)
  message: { success: false, message: "Too many refresh attempts, please try again later.", code: "RATE_LIMIT_EXCEEDED", errors: [] }
});

const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many logout attempts, please try again later.", code: "RATE_LIMIT_EXCEEDED", errors: [] }
});

// CSRF guard for cookie-authenticated endpoints. These requests carry the httpOnly
// refresh token automatically, so cross-site HTML forms could otherwise forge them.
// No Origin/Referer => non-browser client (curl, mobile), which is safe here because
// such clients cannot implicitly send our cookies anyway.
const cookieOriginGuard = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) {
    return next();
  }
  const candidate = (origin || referer || "").replace(/\/+$/, "").toLowerCase();
  if (!candidate) {
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

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/refresh", refreshLimiter, cookieOriginGuard, refresh);
router.post("/logout", logoutLimiter, cookieOriginGuard, logout);
router.get("/me", requireAuth, me);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password", passwordResetLimiter, resetPassword);

export default router;