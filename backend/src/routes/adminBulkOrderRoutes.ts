import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { requireCustomDesignEnabled } from "../config/features";
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

router.get("/", requirePermission("bulkOrders", "view"), getAdminBulkRequests);
router.get("/:id", requirePermission("bulkOrders", "view"), getAdminBulkRequestById);
router.post("/:id/mockup", requireCustomDesignEnabled, requirePermission("bulkOrders", "manage"), uploadAdminMockup);
router.post("/:id/quote", requirePermission("bulkOrders", "manage"), createAdminQuote);
router.patch("/:id/status", requirePermission("bulkOrders", "manage"), updateBulkStatus);

export default router;
