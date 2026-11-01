import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getAdminShippingSettings,
  updateAdminShippingSettings,
} from "../controllers/adminShippingSettingsController";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/shipping", getAdminShippingSettings);
router.put("/shipping", updateAdminShippingSettings);

export default router;
