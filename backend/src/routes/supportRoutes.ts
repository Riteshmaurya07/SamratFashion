import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAuth } from "../middleware/auth";
import { getRateLimitStore } from "../middleware/rateLimitStore";
import {
  createTicket,
  getMyTickets,
  getTicketById,
  addCustomerMessage,
  closeTicket,
} from "../controllers/supportController";

const router = Router();

// N-L12: Dedicated rate limiter for support ticket replies
const supportReplyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: getRateLimitStore("support_reply", true),
  message: { success: false, message: "Too many messages sent, please try again later." },
});

// Protect all customer support endpoints
router.use(requireAuth);

router.post("/tickets", createTicket);
router.get("/tickets", getMyTickets);
router.get("/tickets/:id", getTicketById);
router.post("/tickets/:id/messages", supportReplyLimiter, addCustomerMessage);
router.post("/tickets/:id/close", closeTicket);

export default router;
