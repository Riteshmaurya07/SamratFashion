import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
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
router.post("/categories", requirePermission("categories", "manage"), createCategory);
router.get("/categories", requirePermission("categories", "view"), getAdminCategories);
router.get("/categories/:id", requirePermission("categories", "view"), getAdminCategoryById);
router.put("/categories/:id", requirePermission("categories", "manage"), updateCategory);
router.patch("/categories/:id/status", requirePermission("categories", "manage"), updateCategoryStatus);
router.delete("/categories/:id", requirePermission("categories", "manage"), deleteCategory);

// Themes
router.post("/themes", requirePermission("themes", "manage"), createTheme);
router.get("/themes", requirePermission("themes", "view"), getAdminThemes);
router.get("/themes/:id", requirePermission("themes", "view"), getAdminThemeById);
router.put("/themes/:id", requirePermission("themes", "manage"), updateTheme);
router.patch("/themes/:id/status", requirePermission("themes", "manage"), updateThemeStatus);

// Products
router.post("/products", requirePermission("products", "manage"), createProduct);
router.get("/products", requirePermission("products", "view"), getAdminProducts);
router.get("/products/:id", requirePermission("products", "view"), getAdminProductById);
router.put("/products/:id", requirePermission("products", "manage"), updateProduct);
router.patch("/products/:id/status", requirePermission("products", "manage"), updateProductStatus);
router.delete("/products/:id", requirePermission("products", "manage"), deleteProduct);

// Inventory
router.get("/products/:id/inventory", requirePermission("inventory", "view"), getInventoryHistory);
router.patch("/products/:productId/variants/:variantId/inventory", inventoryLimiter, requirePermission("inventory", "manage"), adjustInventory);

export default router;
