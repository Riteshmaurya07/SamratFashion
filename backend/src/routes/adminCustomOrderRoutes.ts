import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  getCustomOrders,
  getCustomOrderById,
  updatePrintJobStatus,
  addProductionNote,
  generatePrintSheetExport,
  uploadStaffMockup,
} from "../controllers/adminCustomOrderController";

const router = Router();

// Protect all custom order admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", requirePermission("customOrders", "view"), getCustomOrders);
router.get("/:id", requirePermission("customOrders", "view"), getCustomOrderById);
router.post("/:id/items/:itemId/mockup", requirePermission("customOrders", "manage"), uploadStaffMockup);
router.put("/print-jobs/:printJobId/status", requirePermission("customOrders", "manage"), updatePrintJobStatus);
router.post("/print-jobs/:printJobId/notes", requirePermission("customOrders", "manage"), addProductionNote);
router.get("/:orderId/export", requirePermission("customOrders", "view"), generatePrintSheetExport);

export default router;
