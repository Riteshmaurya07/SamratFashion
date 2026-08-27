import { Router } from "express";
import {
  getCategories, getCategoryBySlug,
  getThemes, getThemeBySlug,
  getProducts, getProductBySlug,
  getHomepageCatalog, getCustomizableProducts
} from "../controllers/catalogController";

const router = Router();

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

export default router;
