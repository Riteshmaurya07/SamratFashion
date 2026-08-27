import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getAdminBanners,
  createAdminBanner,
  updateAdminBannerStatus,
  deleteAdminBanner,
  getAdminCampaigns,
  createAdminCampaign,
  updateAdminCampaignStatus,
} from "../controllers/adminCmsController";

const router = Router();

// Protect all CMS admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

// Banner Endpoints
router.get("/banners", getAdminBanners);
router.post("/banners", createAdminBanner);
router.patch("/banners/:id/status", updateAdminBannerStatus);
router.delete("/banners/:id", deleteAdminBanner);

// Campaign Endpoints
router.get("/campaigns", getAdminCampaigns);
router.post("/campaigns", createAdminCampaign);
router.patch("/campaigns/:id/status", updateAdminCampaignStatus);

export default router;
