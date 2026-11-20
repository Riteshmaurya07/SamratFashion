import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  getProductionQueue,
  getProductionAnalytics,
  batchUpdatePriority,
  batchExportPrintJobs,
} from "../controllers/adminProductionController";

const router = Router();

// Protect all production admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/queue", requirePermission("production", "view"), getProductionQueue);
router.get("/analytics", requirePermission("production", "view"), getProductionAnalytics);
router.put("/priority/batch", requirePermission("production", "manage"), batchUpdatePriority);
router.post("/batch-export", requirePermission("production", "manage"), batchExportPrintJobs);

export default router;
