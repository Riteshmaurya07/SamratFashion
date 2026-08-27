import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getAdminReviews,
  moderateReview,
} from "../controllers/adminReviewController";

const router = Router();

// Protect all review admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", getAdminReviews);
router.put("/:id/status", moderateReview);

export default router;
