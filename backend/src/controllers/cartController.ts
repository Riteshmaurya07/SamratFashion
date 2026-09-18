import { Request, Response, NextFunction } from "express";
import { Cart } from "../models/Cart";
import { Product, ProductStatus } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";
import { AppError } from "../utils/AppError";
import mongoose from "mongoose";
import { validateAndCalculateCouponDiscount } from "../utils/couponEngine";
import { applyCouponSchema } from "../utils/couponValidation";
import { PricingService } from "../services/pricingService";

const getCalculatedCart = async (userId: string) => {
  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({ userId, items: [] });
  }

  await cart.populate({
    path: "items.productId",
    select: "name slug basePrice mrp discount images variants status isAvailable",
  });

  let subtotal = 0;
  const itemsWithPrices = [];

  for (let i = 0; i < cart.items.length; i++) {
    const item: any = cart.items[i];
    const product = item.productId;

    if (!product || product.status !== ProductStatus.ACTIVE) {
      itemsWithPrices.push({ ...item.toObject(), isAvailable: false, unitPrice: 0, lineTotal: 0 });
      continue;
    }

    try {
      // Use authoritative pricing service
      const snapshot = await PricingService.calculateItemPricing({
        productId: product._id.toString(),
        variantId: item.variantId.toString(),
        quantity: item.quantity,
        isCustomized: item.isCustomized,
        customConfigurations: item.customConfigurations,
      });

      // Attach updated snapshot to cart
      cart.items[i].pricingSnapshot = snapshot;
      
      subtotal += snapshot.total; // The total per item group (includes bulk discounts)
      
      // Determine display image logic
      let displayImage: string | undefined = undefined;
      const variant = product.variants.find((v: any) => v._id.toString() === item.variantId.toString());
      if (variant && variant.images && variant.images.length > 0) {
        displayImage = variant.images[0];
      } else if (variant && variant.color) {
        const sameColor = product.variants.find((v: any) => v.color === variant.color && v.images?.length > 0);
        if (sameColor) displayImage = sameColor.images[0];
        else displayImage = product.images[0];
      } else {
        displayImage = product.images[0];
      }

      itemsWithPrices.push({
        _id: item._id,
        productId: {
          _id: product._id,
          name: product.name,
          slug: product.slug,
          images: product.images,
          basePrice: product.basePrice,
        },
        variantId: item.variantId,
        isCustomized: item.isCustomized,
        customConfigurations: item.customConfigurations,
        pricingSnapshot: snapshot,
        variantDetails: {
          size: variant?.size,
          color: variant?.color,
          stock: variant?.stock,
          image: displayImage,
        },
        quantity: item.quantity,
        unitPrice: snapshot.subtotal / (item.quantity || 1), // Approximate unit for display
        lineTotal: snapshot.total,
        isAvailable: true,
      });
    } catch (err) {
      // If validation fails, mark as unavailable
      itemsWithPrices.push({ ...item.toObject(), isAvailable: false, unitPrice: 0, lineTotal: 0 });
    }
  }

  // Save the calculated snapshots back to the cart DB so it's always up to date
  await cart.save();

  let discount = 0;
  let appliedCoupon = null;

  if (cart.couponCode) {
    try {
      const couponResult = await validateAndCalculateCouponDiscount(cart.couponCode, userId, itemsWithPrices);
      discount = couponResult.discountAmount;
      appliedCoupon = couponResult.coupon;
    } catch (err) {
      cart.couponCode = undefined;
      await cart.save();
    }
  }

  const eligibleSubtotalForShipping = subtotal - discount;
  const shipping = subtotal > 0 && eligibleSubtotalForShipping < 999 ? 100 : 0;
  const total = Math.max(0, subtotal - discount + shipping);

  return {
    _id: cart._id,
    userId: cart.userId,
    items: itemsWithPrices,
    coupon: appliedCoupon,
    summary: {
      subtotal,
      discount,
      shipping,
      tax: 0,
      total,
    },
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

    // Call pricing service merely to validate everything
    const snapshot = await PricingService.calculateItemPricing({
      productId,
      variantId,
      quantity,
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
      // For customized, we don't merge, we just push a new line item.
      cart.items.push({
        productId: new mongoose.Types.ObjectId(productId),
        variantId: new mongoose.Types.ObjectId(variantId), // Primary variant
        quantity: 1, // Quantity represented inside customConfigurations
        isCustomized: true,
        customConfigurations,
        pricingSnapshot: snapshot,
      });
    } else {
      const existingItemIndex = cart.items.findIndex(
        (item) => item.productId.toString() === productId && item.variantId.toString() === variantId && !item.isCustomized
      );
      if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity += quantity;
      } else {
        cart.items.push({
          productId: new mongoose.Types.ObjectId(productId),
          variantId: new mongoose.Types.ObjectId(variantId),
          quantity,
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
        item.customConfigurations = customConfigurations;
      }
    } else {
      if (quantity < 1) throw new AppError("Invalid quantity", 400);
      item.quantity = quantity;
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

    if (itemId.includes("_")) {
      const [pid, vid] = itemId.split("_");
      cart.items = cart.items.filter((i) => !(i.productId.toString() === pid && i.variantId.toString() === vid && !i.isCustomized));
    } else {
      cart.items = cart.items.filter((i) => i._id?.toString() !== itemId);
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
