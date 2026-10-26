import { Router } from "express";
import {
  getPublicBanners,
  getPublicActiveCampaigns,
  trackBannerImpression,
  trackBannerClick,
} from "../controllers/cmsCatalogController";

const router = Router();

// Public Read Endpoints (Active & Valid Date Range Only)
router.get("/banners", getPublicBanners);
router.post("/banners/:id/impression", trackBannerImpression);
router.post("/banners/:id/click", trackBannerClick);
router.get("/campaigns/active", getPublicActiveCampaigns);

export default router;
