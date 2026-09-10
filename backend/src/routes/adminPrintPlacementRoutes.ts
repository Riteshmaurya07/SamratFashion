import { Router } from "express";
import { getTemplates, getTemplateById, createTemplate, updateTemplate, deleteTemplate } from "../controllers/adminPrintPlacementController";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

router.use(requireAuth);
router.use(requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", getTemplates);
router.post("/", createTemplate);
router.get("/:id", getTemplateById);
router.put("/:id", updateTemplate);
router.delete("/:id", deleteTemplate);

export default router;
