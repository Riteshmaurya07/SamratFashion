import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createBulkRequest,
  getMyBulkRequests,
  getQuoteById,
  acceptQuote,
  rejectQuote,
} from "../controllers/bulkOrderController";

const router = Router();

// Protect all customer bulk order endpoints
router.use(requireAuth);

router.post("/request", createBulkRequest);
router.get("/", getMyBulkRequests);
router.get("/quote/:quoteId", getQuoteById);
router.post("/quote/:quoteId/accept", acceptQuote);
router.post("/quote/:quoteId/reject", rejectQuote);

export default router;
