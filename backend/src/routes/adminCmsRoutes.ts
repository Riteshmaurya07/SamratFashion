import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
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
import { invalidateCmsCache } from "../controllers/cmsCatalogController";

const router = Router();

// Protect all CMS admin endpoints with ADMIN / SUPER_ADMIN role
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

// Invalidate public CMS cache on any admin mutation
router.use((req, res, next) => {
  if (req.method !== "GET") {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateCmsCache();
      }
    });
  }
  next();
});

// Banner Endpoints
router.get("/banners", requirePermission("banners", "view"), getAdminBanners);
router.post("/banners", requirePermission("banners", "manage"), createAdminBanner);
router.put("/banners/reorder", requirePermission("banners", "manage"), reorderAdminBanners);
router.put("/banners/:id", requirePermission("banners", "manage"), updateAdminBanner);
router.patch("/banners/:id/status", requirePermission("banners", "manage"), updateAdminBannerStatus);
router.delete("/banners/:id", requirePermission("banners", "manage"), deleteAdminBanner);

// Campaign Endpoints
router.get("/campaigns", requirePermission("campaigns", "view"), getAdminCampaigns);
router.post("/campaigns", requirePermission("campaigns", "manage"), createAdminCampaign);
router.put("/campaigns/:id", requirePermission("campaigns", "manage"), updateAdminCampaign);
router.patch("/campaigns/:id/status", requirePermission("campaigns", "manage"), updateAdminCampaignStatus);
router.delete("/campaigns/:id", requirePermission("campaigns", "manage"), deleteAdminCampaign);

export default router;
