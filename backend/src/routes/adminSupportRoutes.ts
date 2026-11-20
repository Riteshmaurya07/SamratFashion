import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  getAdminTickets,
  getAdminTicketById,
  updateTicketStatus,
  updateTicketPriority,
  addAdminReply,
  assignAdminTicket,
} from "../controllers/adminSupportController";

const router = Router();

// Protect all support admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/tickets", requirePermission("support", "view"), getAdminTickets);
router.get("/tickets/:id", requirePermission("support", "view"), getAdminTicketById);
router.patch("/tickets/:id/status", requirePermission("support", "manage"), updateTicketStatus);
router.patch("/tickets/:id/priority", requirePermission("support", "manage"), updateTicketPriority);
router.post("/tickets/:id/messages", requirePermission("support", "manage"), addAdminReply);
router.post("/tickets/:id/assign", requirePermission("support", "manage"), assignAdminTicket);

export default router;
