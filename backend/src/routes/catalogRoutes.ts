import { Router } from "express";
import {
  getCategories, getCategoryBySlug,
  getThemes, getThemeBySlug,
  getProducts, getProductBySlug, getRecommendedProducts,
  getHomepageCatalog, getCustomizableProducts
} from "../controllers/catalogController";
import {
  getPublicBanners,
  getPublicActiveCampaigns,
} from "../controllers/cmsCatalogController";

const router = Router();

// Banners & CMS Public Endpoints
router.get("/banners", getPublicBanners);
router.get("/campaigns/active", getPublicActiveCampaigns);

// Homepage Aggregation
router.get("/homepage", getHomepageCatalog);

// Customizable Products
router.get("/customizable-products", getCustomizableProducts);

// Categories
router.get("/categories", getCategories);
router.get("/categories/:slug", getCategoryBySlug);

// Themes
router.get("/themes", getThemes);
router.get("/themes/:slug", getThemeBySlug);

// Products
router.get("/products", getProducts);
router.get("/products/:slug", getProductBySlug);
router.get("/products/:slug/recommendations", getRecommendedProducts);
export default router;
