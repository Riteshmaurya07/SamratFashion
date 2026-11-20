import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  getAdminReviews,
  moderateReview,
} from "../controllers/adminReviewController";

const router = Router();

// Protect all review admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", requirePermission("reviews", "view"), getAdminReviews);
router.put("/:id/status", requirePermission("reviews", "manage"), moderateReview);

export default router;
