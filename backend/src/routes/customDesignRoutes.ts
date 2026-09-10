import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createDesign,
  createCustomPrintingRequest,
  getUserDesigns,
  getDesignById,
  updateDesign,
  deleteDesign,
  duplicateDesign,
} from "../controllers/customDesignController";

const router = Router();

router.use(requireAuth);

router.post("/requests", createCustomPrintingRequest);
router.post("/", createDesign);
router.get("/", getUserDesigns);
router.get("/:id", getDesignById);
router.put("/:id", updateDesign);
router.delete("/:id", deleteDesign);
router.post("/:id/duplicate", duplicateDesign);

export default router;
