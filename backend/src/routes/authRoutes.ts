import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { register, login, refresh, logout, me, forgotPassword, resetPassword } from "../controllers/authController";
import { requireAuth } from "../middleware/auth";

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

router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/refresh", refresh); // Not strictly rate-limited like login, let legitimate users refresh
router.post("/logout", logout);
router.get("/me", requireAuth, me);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password", passwordResetLimiter, resetPassword);

export default router;
