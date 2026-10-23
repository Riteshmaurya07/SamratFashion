import { Router } from "express";
import {
  getCatalogItems,
  getCatalogItemBySlug,
  getCatalogCategories,
} from "../controllers/customPrintCatalogController";

const router = Router();

router.get("/categories", getCatalogCategories);
router.get("/", getCatalogItems);
router.get("/:slug", getCatalogItemBySlug);

export default router;
