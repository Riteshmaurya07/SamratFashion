import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  getPricingConfigs,
  getPricingConfigById,
  createOrUpdatePricingConfig,
  deletePricingConfig,
} from "../controllers/adminPrintPricingController";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", requirePermission("printPricing", "view"), getPricingConfigs);
router.get("/:id", requirePermission("printPricing", "view"), getPricingConfigById);
router.post("/", requirePermission("printPricing", "manage"), createOrUpdatePricingConfig);
router.put("/:id", requirePermission("printPricing", "manage"), createOrUpdatePricingConfig);
router.delete("/:id", requirePermission("printPricing", "manage"), deletePricingConfig);

export default router;
