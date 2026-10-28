import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { inventoryLimiter } from "../middleware/rateLimiters";
import {
  createCategory, updateCategory, updateCategoryStatus, deleteCategory, getAdminCategories, getAdminCategoryById,
  createTheme, updateTheme, updateThemeStatus, getAdminThemes, getAdminThemeById,
  createProduct, updateProduct, updateProductStatus, deleteProduct, getAdminProducts, getAdminProductById,
  adjustInventory, getInventoryHistory
} from "../controllers/adminCatalogController";
import { invalidateCatalogCache } from "../controllers/catalogController";

const router = Router();

// Protect all admin catalog routes
router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

// Invalidate public catalog cache on any admin mutation
router.use((req, res, next) => {
  if (req.method !== "GET") {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateCatalogCache();
      }
    });
  }
  next();
});

// Categories
router.post("/categories", createCategory);
router.get("/categories", getAdminCategories);
router.get("/categories/:id", getAdminCategoryById);
router.put("/categories/:id", updateCategory);
router.patch("/categories/:id/status", updateCategoryStatus);
router.delete("/categories/:id", deleteCategory);

// Themes
router.post("/themes", createTheme);
router.get("/themes", getAdminThemes);
router.get("/themes/:id", getAdminThemeById);
router.put("/themes/:id", updateTheme);
router.patch("/themes/:id/status", updateThemeStatus);

// Products
router.post("/products", createProduct);
router.get("/products", getAdminProducts);
router.get("/products/:id", getAdminProductById);
router.put("/products/:id", updateProduct);
router.patch("/products/:id/status", updateProductStatus);
router.delete("/products/:id", deleteProduct);

// Inventory
router.get("/products/:id/inventory", getInventoryHistory);
router.patch("/products/:productId/variants/:variantId/inventory", inventoryLimiter, adjustInventory);

export default router;
