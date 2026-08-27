import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createReview,
  getMyReviews,
  getProductReviews,
} from "../controllers/reviewController";

const router = Router();

// Public Read Endpoint for Approved PDP Reviews & Rating Summaries
router.get("/product/:productId", getProductReviews);

// Protected Customer Endpoints
router.post("/", requireAuth, createReview);
router.get("/my-reviews", requireAuth, getMyReviews);

export default router;
