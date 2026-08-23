import { Router } from "express";
import {
  getWishlist,
  addItemToWishlist,
  removeItemFromWishlist,
  clearWishlist,
} from "../controllers/wishlistController";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.get("/", getWishlist);
router.post("/items/:productId", addItemToWishlist);
router.delete("/items/:productId", removeItemFromWishlist);
router.delete("/", clearWishlist);

export default router;
