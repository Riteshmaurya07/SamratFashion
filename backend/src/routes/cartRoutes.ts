import { Router } from "express";
import {
  getCart,
  addItemToCart,
  updateCartItemQuantity,
  removeCartItem,
  clearCart,
  applyCoupon,
  removeCoupon,
} from "../controllers/cartController";
import { requireAuth } from "../middleware/auth";
import { orderLimiter } from "../middleware/rateLimiters";

const router = Router();

router.use(requireAuth);

router.get("/", getCart);
router.post("/items", addItemToCart);
router.patch("/items/:itemId", updateCartItemQuantity);
router.delete("/items/:itemId", removeCartItem);
router.delete("/", clearCart);
router.post("/apply-coupon", orderLimiter, applyCoupon);
router.post("/remove-coupon", removeCoupon);

export default router;

