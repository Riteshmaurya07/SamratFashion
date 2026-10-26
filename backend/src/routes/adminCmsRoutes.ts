import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  getAdminBanners,
  reorderAdminBanners,
  createAdminBanner,
  updateAdminBanner,
  updateAdminBannerStatus,
  deleteAdminBanner,
  getAdminCampaigns,
  createAdminCampaign,
  updateAdminCampaign,
  updateAdminCampaignStatus,
  deleteAdminCampaign,
} from "../controllers/adminCmsController";

const router = Router();

// Protect all CMS admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

// Banner Endpoints
router.get("/banners", getAdminBanners);
router.post("/banners", createAdminBanner);
router.put("/banners/reorder", reorderAdminBanners);
router.put("/banners/:id", updateAdminBanner);
router.patch("/banners/:id/status", updateAdminBannerStatus);
router.delete("/banners/:id", deleteAdminBanner);

// Campaign Endpoints
router.get("/campaigns", getAdminCampaigns);
router.post("/campaigns", createAdminCampaign);
router.put("/campaigns/:id", updateAdminCampaign);
router.patch("/campaigns/:id/status", updateAdminCampaignStatus);
router.delete("/campaigns/:id", deleteAdminCampaign);

export default router;
