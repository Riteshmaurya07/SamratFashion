import { Router } from "express";
import { getPrintPlacementTemplates } from "../controllers/printPlacementController";

const router = Router();

router.get("/", getPrintPlacementTemplates);

export default router;
