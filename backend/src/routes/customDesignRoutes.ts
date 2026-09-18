import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createDesign,
  getUserDesigns,
  getDesignById,
  updateDesign,
  deleteDesign,
  duplicateDesign,
  approveDesign,
  requestRevision,
} from "../controllers/customDesignController";

const router = Router();

router.use(requireAuth);

router.post("/", createDesign);
router.get("/", getUserDesigns);
router.get("/:id", getDesignById);
router.put("/:id", updateDesign);
router.delete("/:id", deleteDesign);
router.post("/:id/duplicate", duplicateDesign);
router.post("/:id/approve", approveDesign);
router.post("/:id/revision", requestRevision);

export default router;
