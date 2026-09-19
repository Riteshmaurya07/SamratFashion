import { Router } from "express";
import { calculatePricing } from "../controllers/pricingController";

const router = Router();

router.post("/calculate", calculatePricing);

export default router;