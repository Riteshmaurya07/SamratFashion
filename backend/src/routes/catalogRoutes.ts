import { Router } from "express";
import {
  getCategories, getCategoryBySlug,
  getThemes, getThemeBySlug,
  getProducts, getProductBySlug,
  getHomepageCatalog
} from "../controllers/catalogController";

const router = Router();

// Homepage Aggregation
router.get("/homepage", getHomepageCatalog);

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
