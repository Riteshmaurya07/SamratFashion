import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
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

router.get("/queue", getProductionQueue);
router.get("/analytics", getProductionAnalytics);
router.put("/priority/batch", batchUpdatePriority);
router.post("/batch-export", batchExportPrintJobs);

export default router;
