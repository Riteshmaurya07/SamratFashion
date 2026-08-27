import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getCustomOrders,
  getCustomOrderById,
  updatePrintJobStatus,
  addProductionNote,
  generatePrintSheetExport,
} from "../controllers/adminCustomOrderController";

const router = Router();

// Protect all custom order admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", getCustomOrders);
router.get("/:id", getCustomOrderById);
router.put("/print-jobs/:printJobId/status", updatePrintJobStatus);
router.post("/print-jobs/:printJobId/notes", addProductionNote);
router.get("/:orderId/export", generatePrintSheetExport);

export default router;
