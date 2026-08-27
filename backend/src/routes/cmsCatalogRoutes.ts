import { Router } from "express";
import {
  getPublicBanners,
  getPublicActiveCampaigns,
} from "../controllers/cmsCatalogController";

const router = Router();

// Public Read Endpoints (Active & Valid Date Range Only)
router.get("/banners", getPublicBanners);
router.get("/campaigns/active", getPublicActiveCampaigns);

export default router;
