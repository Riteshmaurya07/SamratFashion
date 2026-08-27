import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createTicket,
  getMyTickets,
  getTicketById,
  addCustomerMessage,
  closeTicket,
} from "../controllers/supportController";

const router = Router();

// Protect all customer support endpoints
router.use(requireAuth);

router.post("/tickets", createTicket);
router.get("/tickets", getMyTickets);
router.get("/tickets/:id", getTicketById);
router.post("/tickets/:id/messages", addCustomerMessage);
router.post("/tickets/:id/close", closeTicket);

export default router;
