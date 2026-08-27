import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
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

router.get("/tickets", getAdminTickets);
router.get("/tickets/:id", getAdminTicketById);
router.patch("/tickets/:id/status", updateTicketStatus);
router.patch("/tickets/:id/priority", updateTicketPriority);
router.post("/tickets/:id/messages", addAdminReply);
router.post("/tickets/:id/assign", assignAdminTicket);

export default router;
