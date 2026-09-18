import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { generateDesignAsset } from "../controllers/aiController";

const router = Router();

// Require auth for AI generation to prevent abuse
router.use(requireAuth);

router.post("/generate", generateDesignAsset);

export default router;
