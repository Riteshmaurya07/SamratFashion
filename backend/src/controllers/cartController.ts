import { Request, Response, NextFunction } from "express";
import { Cart } from "../models/Cart";
import { CustomDesign } from "../models/CustomDesign";
import { AppError } from "../utils/AppError";
import mongoose from "mongoose";
import { validateAndCalculateCouponDiscount } from "../utils/couponEngine";
import { applyCouponSchema } from "../utils/couponValidation";
import { PricingService } from "../services/pricingService";
import { PricingEngineService } from "../services/pricing/PricingEngineService";
const getCalculatedCart = async (userId: string) => {
  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({ userId, items: [] });
  }

  const calculation = await PricingEngineService.calculate({
    userId,
    items: cart.items,
    couponCode: cart.couponCode,
  });

  // Attach updated snapshots back to cart items and sync coupon state
  for (let i = 0; i < cart.items.length; i++) {
    const processed = calculation.items[i];
    if (processed && processed.pricingSnapshot) {
      cart.items[i].pricingSnapshot = processed.pricingSnapshot;
    }
  }

  // If coupon code was previously stored in cart but is no longer valid, clear it
  if (cart.couponCode && !calculation.coupon) {
    cart.couponCode = undefined;
  }

  await cart.save();

  return {
    _id: cart._id,
    userId: cart.userId,
    items: calculation.items,
    coupon: calculation.coupon,
    summary: calculation.summary,
  };
};

export const getCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const calculatedCart = await getCalculatedCart(userId);
    res.status(200).json({ success: true, data: calculatedCart, code: "SUCCESS" });
  } catch (error) {
    next(error);
  }
};

export const addItemToCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { productId, variantId, quantity, isCustomized, customConfigurations } = req.body;

    if (!productId || (!variantId && !isCustomized)) {
      throw new AppError("Invalid cart item data", 400, "VALIDATION_ERROR");
    }

    const parsedQty = Math.floor(Number(quantity || 1));
    if (!isCustomized && (!Number.isFinite(parsedQty) || parsedQty < 1)) {
      throw new AppError("Quantity must be a positive integer", 400, "VALIDATION_ERROR");
    }

    // Call pricing service merely to validate everything
    const snapshot = await PricingService.calculateItemPricing({
      productId,
      variantId,
      quantity: parsedQty,
      isCustomized,
      customConfigurations,
    });

    // Security: validate that every designId in customConfigurations belongs to this user
    if (isCustomized && customConfigurations) {
      for (const config of customConfigurations) {
        if (config.designId) {
          const design = await CustomDesign.findById(config.designId);
          if (!design || design.userId.toString() !== userId) {
            throw new AppError("Design not found or does not belong to you", 403, "FORBIDDEN");
          }
        }
      }
    }

    let cart = await Cart.findOne({ userId });
    if (!cart) cart = new Cart({ userId, items: [] });

    if (isCustomized) {
      const totalCustomQty = customConfigurations?.reduce((acc: number, c: any) => {
        const configQty = c.sizeDistribution?.reduce((s: number, d: any) => {
          const q = Math.floor(Number(d.quantity));
          if (!Number.isFinite(q) || q < 0) {
            throw new AppError("Invalid size distribution quantity", 400, "VALIDATION_ERROR");
          }
          return s + q;
        }, 0) || 0;
        return acc + configQty;
      }, 0) || parsedQty;

      if (!Number.isFinite(totalCustomQty) || totalCustomQty < 1) {
        throw new AppError("Quantity must be a positive integer", 400, "VALIDATION_ERROR");
      }

      cart.items.push({
        productId: new mongoose.Types.ObjectId(productId),
        variantId: new mongoose.Types.ObjectId(variantId),
        quantity: totalCustomQty,
        isCustomized: true,
        customConfigurations,
        pricingSnapshot: snapshot,
      });
    } else {
      const existingItemIndex = cart.items.findIndex(
        (item) => item.productId.toString() === productId && item.variantId.toString() === variantId && !item.isCustomized
      );
      if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity += parsedQty;
      } else {
        cart.items.push({
          productId: new mongoose.Types.ObjectId(productId),
          variantId: new mongoose.Types.ObjectId(variantId),
          quantity: parsedQty,
          isCustomized: false,
          pricingSnapshot: snapshot,
        });
      }
    }

    await cart.save();
    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({ success: true, data: calculatedCart, code: "SUCCESS" });
  } catch (error) {
    next(error);
  }
};

export const updateCartItemQuantity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const itemId = req.params.itemId as string; // This can be actual _id for custom items
    const { quantity, customConfigurations } = req.body;

    const cart = await Cart.findOne({ userId });
    if (!cart) throw new AppError("Cart not found", 404, "NOT_FOUND");

    // First try by mongo _id (useful for custom items)
    let item = cart.items.find((i) => i._id?.toString() === itemId);
    
    // If not found, try by product_variant format (legacy/standard)
    if (!item && itemId.includes("_")) {
      const [pid, vid] = itemId.split("_");
      item = cart.items.find((i) => i.productId.toString() === pid && i.variantId.toString() === vid && !i.isCustomized);
    }

    if (!item) throw new AppError("Item not in cart", 404, "NOT_FOUND");

    if (item.isCustomized) {
      if (customConfigurations) {
        const totalCustomQty = customConfigurations.reduce((acc: number, c: any) => {
          const configQty = c.sizeDistribution?.reduce((s: number, d: any) => {
            const q = Math.floor(Number(d.quantity));
            if (!Number.isFinite(q) || q < 0) {
              throw new AppError("Invalid size distribution quantity", 400, "VALIDATION_ERROR");
            }
            return s + q;
          }, 0) || 0;
          return acc + configQty;
        }, 0);

        if (!Number.isFinite(totalCustomQty) || totalCustomQty < 1) {
          throw new AppError("Quantity must be a positive integer", 400, "VALIDATION_ERROR");
        }
        item.customConfigurations = customConfigurations;
        item.quantity = totalCustomQty;
      }
    } else {
      const parsedQty = Math.floor(Number(quantity));
      if (!Number.isFinite(parsedQty) || parsedQty < 1) {
        throw new AppError("Quantity must be a positive integer", 400, "VALIDATION_ERROR");
      }
      item.quantity = parsedQty;
    }

    // Validates via pricing service implicitly when saving in getCalculatedCart
    await cart.save();
    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({ success: true, data: calculatedCart, code: "SUCCESS" });
  } catch (error) {
    next(error);
  }
};

export const removeCartItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const itemId = req.params.itemId as string;

    const cart = await Cart.findOne({ userId });
    if (!cart) throw new AppError("Cart not found", 404, "NOT_FOUND");

    const initialLength = cart.items.length;
    // 1. First attempt to remove by exact cart item MongoDB _id
    cart.items = cart.items.filter((i) => i._id?.toString() !== itemId);

    // 2. If no item was removed by _id, try composite pid_vid key matching
    if (cart.items.length === initialLength && itemId.includes("_")) {
      const [pid, vid] = itemId.split("_");
      cart.items = cart.items.filter(
        (i) => !(i.productId.toString() === pid && i.variantId.toString() === vid)
      );
    }

    await cart.save();
    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({ success: true, data: calculatedCart, code: "SUCCESS" });
  } catch (error) {
    next(error);
  }
};

export const applyCoupon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { code } = applyCouponSchema.parse(req.body);

    let cart = await Cart.findOne({ userId });
    if (!cart || cart.items.length === 0) throw new AppError("Cart is empty", 400, "CART_EMPTY");

    const calculatedBefore = await getCalculatedCart(userId);
    const result = await validateAndCalculateCouponDiscount(code, userId, calculatedBefore.items);

    cart.couponCode = result.coupon.code;
    await cart.save();
    
    const calculatedCart = await getCalculatedCart(userId);
    res.status(200).json({ success: true, message: `Coupon applied`, data: calculatedCart, code: "SUCCESS" });
  } catch (error) {
    next(error);
  }
};

export const removeCoupon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const cart = await Cart.findOne({ userId });
    if (cart) {
      cart.couponCode = undefined;
      await cart.save();
    }
    const calculatedCart = await getCalculatedCart(userId);
    res.status(200).json({ success: true, message: "Coupon removed", data: calculatedCart, code: "SUCCESS" });
  } catch (error) {
    next(error);
  }
};

export const clearCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const cart = await Cart.findOne({ userId });
    if (cart) {
      cart.items = [];
      cart.couponCode = undefined;
      await cart.save();
    }
    res.status(200).json({
      success: true,
      data: { items: [], summary: { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0 } },
      code: "SUCCESS"
    });
  } catch (error) {
    next(error);
  }
};
