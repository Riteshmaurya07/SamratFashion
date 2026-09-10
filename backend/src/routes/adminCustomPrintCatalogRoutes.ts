import { Router } from "express";
import {
  getAdminCatalogItems,
  getAdminCatalogItemById,
  createAdminCatalogItem,
  updateAdminCatalogItem,
  deactivateAdminCatalogItem,
  activateAdminCatalogItem,
} from "../controllers/adminCustomPrintCatalogController";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", getAdminCatalogItems);
router.get("/:id", getAdminCatalogItemById);
router.post("/", createAdminCatalogItem);
router.put("/:id", updateAdminCatalogItem);
router.patch("/:id/deactivate", deactivateAdminCatalogItem);
router.patch("/:id/activate", activateAdminCatalogItem);

export default router;
