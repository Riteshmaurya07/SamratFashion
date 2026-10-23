import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getPricingConfigs,
  getPricingConfigById,
  createOrUpdatePricingConfig,
  deletePricingConfig,
} from "../controllers/adminPrintPricingController";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", getPricingConfigs);
router.get("/:id", getPricingConfigById);
router.post("/", createOrUpdatePricingConfig);
router.put("/:id", createOrUpdatePricingConfig);
router.delete("/:id", deletePricingConfig);

export default router;
