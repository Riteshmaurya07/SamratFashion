import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth";
import {
  createBulkRequest,
  getMyBulkRequests,
  getMyBulkRequestById,
  approveMockup,
  requestMockupRevision,
  getQuoteById,
  acceptQuote,
  rejectQuote,
} from "../controllers/bulkOrderController";

const router = Router();

router.post("/request", optionalAuth, createBulkRequest);

// Protect customer account endpoints
router.use(requireAuth);

router.get("/", getMyBulkRequests);
router.get("/requests/:id", getMyBulkRequestById);
router.post("/requests/:id/approve-mockup", approveMockup);
router.post("/requests/:id/request-revision", requestMockupRevision);
router.get("/quote/:quoteId", getQuoteById);
router.post("/quote/:quoteId/accept", acceptQuote);
router.post("/quote/:quoteId/reject", rejectQuote);

export default router;
