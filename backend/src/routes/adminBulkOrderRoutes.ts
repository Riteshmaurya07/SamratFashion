import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getAdminBulkRequests,
  getAdminBulkRequestById,
  uploadAdminMockup,
  createAdminQuote,
  updateBulkStatus,
} from "../controllers/adminBulkOrderController";

const router = Router();

// Protect all bulk admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", getAdminBulkRequests);
router.get("/:id", getAdminBulkRequestById);
router.post("/:id/mockup", uploadAdminMockup);
router.post("/:id/quote", createAdminQuote);
router.patch("/:id/status", updateBulkStatus);

export default router;
