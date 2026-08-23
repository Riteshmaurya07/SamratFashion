import { Request, Response, NextFunction } from "express";
import { Cart } from "../models/Cart";
import { Product, ProductStatus } from "../models/Product";
import { AppError } from "../utils/AppError";
import mongoose from "mongoose";
import { validateAndCalculateCouponDiscount } from "../utils/couponEngine";
import { applyCouponSchema } from "../utils/couponValidation";

// Helper to calculate cart totals and return populated cart
const getCalculatedCart = async (userId: string) => {
  let cart = await Cart.findOne({ userId });
  if (!cart) {
    cart = await Cart.create({ userId, items: [] });
  }

  // Populate products to get current prices
  await cart.populate({
    path: "items.productId",
    select: "name slug basePrice mrp discount images variants status isAvailable",
  });

  let subtotal = 0;
  const itemsWithPrices = cart.items.map((item: any) => {
    const product = item.productId;
    if (!product || product.status !== ProductStatus.ACTIVE) {
      return { ...item.toObject(), isAvailable: false, unitPrice: 0, lineTotal: 0 };
    }

    const variant = product.variants.find(
      (v: any) => v._id && v._id.toString() === item.variantId.toString()
    );

    if (!variant || !variant.isAvailable) {
      return { ...item.toObject(), isAvailable: false, unitPrice: 0, lineTotal: 0 };
    }

    const unitPrice = product.basePrice + (variant.additionalPrice || 0);
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;

    return {
      _id: item._id, // if any
      productId: {
        _id: product._id,
        name: product.name,
        slug: product.slug,
        images: product.images,
        basePrice: product.basePrice,
      },
      variantId: item.variantId,
      variantDetails: {
        size: variant.size,
        color: variant.color,
        hexCode: variant.hexCode,
        sku: variant.sku,
        stock: variant.stock,
      },
      quantity: item.quantity,
      unitPrice,
      lineTotal,
      isAvailable: variant.stock >= item.quantity, // check stock
    };
  });

  // Coupon evaluation
  let discount = 0;
  let appliedCoupon = null;

  if (cart.couponCode) {
    try {
      const couponResult = await validateAndCalculateCouponDiscount(cart.couponCode, userId, itemsWithPrices);
      discount = couponResult.discountAmount;
      appliedCoupon = couponResult.coupon;
    } catch (err) {
      // Coupon is no longer valid for this cart state; remove coupon reference
      cart.couponCode = undefined;
      await cart.save();
    }
  }

  // Calculate totals
  const eligibleSubtotalForShipping = subtotal - discount;
  const shipping = subtotal > 0 && eligibleSubtotalForShipping < 999 ? 100 : 0; // Free shipping over 999
  const tax = 0; // Base prices treated as inclusive
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
      tax,
      total,
    },
  };
};

export const getCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({
      success: true,
      data: calculatedCart,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};

export const addItemToCart = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { productId, variantId, quantity } = req.body;

    if (!productId || !variantId || !quantity || quantity < 1) {
      throw new AppError("Invalid cart item data", 400, "VALIDATION_ERROR");
    }

    const product = await Product.findById(productId);
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new AppError("Product is unavailable", 400, "BAD_REQUEST");
    }

    const variant = product.variants.find((v: any) => v._id && v._id.toString() === variantId);
    if (!variant || !variant.isAvailable) {
      throw new AppError("Variant is unavailable", 400, "BAD_REQUEST");
    }

    let cart = await Cart.findOne({ userId });
    if (!cart) {
      cart = new Cart({ userId, items: [] });
    }

    const existingItemIndex = cart.items.findIndex(
      (item) => item.productId.toString() === productId && item.variantId.toString() === variantId
    );

    let newQuantity = quantity;
    if (existingItemIndex > -1) {
      newQuantity += cart.items[existingItemIndex].quantity;
    }

    if (newQuantity > variant.stock) {
      throw new AppError(`Only ${variant.stock} items available in stock`, 400, "STOCK_LIMIT_EXCEEDED");
    }

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity = newQuantity;
    } else {
      cart.items.push({
        productId: new mongoose.Types.ObjectId(productId),
        variantId: new mongoose.Types.ObjectId(variantId),
        quantity,
      });
    }

    await cart.save();

    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({
      success: true,
      data: calculatedCart,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};

export const updateCartItemQuantity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const rawItemId = req.params.itemId ? String(req.params.itemId) : "";
    let productId = req.body.productId;
    let variantId = req.body.variantId;
    const { quantity } = req.body;

    if (rawItemId && rawItemId.includes("_")) {
      const parts = rawItemId.split("_");
      productId = parts[0];
      variantId = parts[1];
    }

    if (!productId || !variantId || typeof quantity !== "number" || quantity < 1) {
      throw new AppError("Invalid update data", 400, "VALIDATION_ERROR");
    }

    const product = await Product.findById(productId);
    const variant = product?.variants.find((v: any) => v._id && v._id.toString() === variantId);

    if (!product || !variant) {
      throw new AppError("Product or variant not found", 404, "NOT_FOUND");
    }

    if (quantity > variant.stock) {
      throw new AppError(`Only ${variant.stock} items available in stock`, 400, "STOCK_LIMIT_EXCEEDED");
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      throw new AppError("Cart not found", 404, "NOT_FOUND");
    }

    const item = cart.items.find(
      (i) => i.productId.toString() === productId && i.variantId.toString() === variantId
    );

    if (!item) {
      throw new AppError("Item not in cart", 404, "NOT_FOUND");
    }

    item.quantity = quantity;
    await cart.save();

    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({
      success: true,
      data: calculatedCart,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};

export const removeCartItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const rawItemId = req.params.itemId ? String(req.params.itemId) : "";
    let productId = req.body.productId;
    let variantId = req.body.variantId;

    if (rawItemId && rawItemId.includes("_")) {
      const parts = rawItemId.split("_");
      productId = parts[0];
      variantId = parts[1];
    }

    if (!productId || !variantId) {
      throw new AppError("Missing product or variant ID", 400, "VALIDATION_ERROR");
    }

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      throw new AppError("Cart not found", 404, "NOT_FOUND");
    }

    cart.items = cart.items.filter(
      (item) => !(item.productId.toString() === productId && item.variantId.toString() === variantId)
    );

    await cart.save();

    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({
      success: true,
      data: calculatedCart,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};

export const applyCoupon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { code } = applyCouponSchema.parse(req.body);

    let cart = await Cart.findOne({ userId });
    if (!cart || cart.items.length === 0) {
      throw new AppError("Cart is empty", 400, "CART_EMPTY");
    }

    const calculatedBefore = await getCalculatedCart(userId);
    const result = await validateAndCalculateCouponDiscount(code, userId, calculatedBefore.items);

    cart.couponCode = result.coupon.code;
    await cart.save();

    const calculatedCart = await getCalculatedCart(userId);

    res.status(200).json({
      success: true,
      message: `Coupon '${result.coupon.code}' applied successfully`,
      data: calculatedCart,
      code: "SUCCESS",
      errors: [],
    });
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

    res.status(200).json({
      success: true,
      message: "Coupon removed successfully",
      data: calculatedCart,
      code: "SUCCESS",
      errors: [],
    });
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
      data: {
        items: [],
        summary: { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0 }
      },
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};
