import { Router } from "express";
import { calculatePricing } from "../controllers/pricingController";
import {
  getPublicPricingRule,
  calculatePublicBulkEstimate,
} from "../controllers/adminPrintPricingController";

const router = Router();

router.post("/calculate", calculatePricing);
router.get("/volume-rules", getPublicPricingRule);
router.post("/volume-estimate", calculatePublicBulkEstimate);

export default router;
