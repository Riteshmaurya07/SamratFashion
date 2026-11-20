import { Router } from "express";
import {
  getAdminCatalogItems,
  getAdminCatalogItemById,
  createAdminCatalogItem,
  updateAdminCatalogItem,
  deactivateAdminCatalogItem,
  activateAdminCatalogItem,
  deleteAdminCatalogItem,
} from "../controllers/adminCustomPrintCatalogController";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", requirePermission("printCatalog", "view"), getAdminCatalogItems);
router.get("/:id", requirePermission("printCatalog", "view"), getAdminCatalogItemById);
router.post("/", requirePermission("printCatalog", "manage"), createAdminCatalogItem);
router.put("/:id", requirePermission("printCatalog", "manage"), updateAdminCatalogItem);
router.patch("/:id/deactivate", requirePermission("printCatalog", "manage"), deactivateAdminCatalogItem);
router.patch("/:id/activate", requirePermission("printCatalog", "manage"), activateAdminCatalogItem);
router.delete("/:id", requirePermission("printCatalog", "manage"), deleteAdminCatalogItem);

export default router;
