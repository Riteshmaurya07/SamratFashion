import { Router } from "express";
import { getLiveness, getReadiness } from "../controllers/healthController";

const router = Router();

// Public Health Routes
router.get("/live", getLiveness);
router.get("/ready", getReadiness);

// Legacy health endpoint
router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    code: "SUCCESS",
    errors: []
  });
});

export default router;
