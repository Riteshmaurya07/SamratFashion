import { Router } from "express";
import { getTemplates, getTemplateById } from "../controllers/customTemplateController";

const router = Router();

// Publicly accessible for studio
router.get("/", getTemplates);
router.get("/:id", getTemplateById);

export default router;
