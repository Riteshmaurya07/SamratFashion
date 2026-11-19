import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { generateDesignAsset } from "../controllers/aiController";
import { aiGenerationLimiter } from "../middleware/rateLimiters";

const router = Router();

// Require auth for AI generation to prevent abuse
router.use(requireAuth);

router.post("/generate", aiGenerationLimiter, generateDesignAsset);

export default router;
