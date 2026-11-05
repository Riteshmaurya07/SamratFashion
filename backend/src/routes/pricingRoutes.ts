import { Router } from "express";
import { requireCustomDesignEnabled } from "../config/features";
import { calculatePricing } from "../controllers/pricingController";
import {
  getPublicPricingRule,
  calculatePublicBulkEstimate,
} from "../controllers/adminPrintPricingController";

const router = Router();

router.post("/calculate", requireCustomDesignEnabled, calculatePricing);
router.get("/volume-rules", getPublicPricingRule);
router.post("/volume-estimate", calculatePublicBulkEstimate);

export default router;
