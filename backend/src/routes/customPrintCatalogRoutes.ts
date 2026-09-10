import { Router } from "express";
import { getCatalogItems, getCatalogItemBySlug } from "../controllers/customPrintCatalogController";

const router = Router();

router.get("/", getCatalogItems);
router.get("/:slug", getCatalogItemBySlug);

export default router;
