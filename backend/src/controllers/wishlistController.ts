import { Request, Response, NextFunction } from "express";
import { Wishlist } from "../models/Wishlist";
import { Product } from "../models/Product";
import { AppError } from "../utils/AppError";

const POPULATE_CONFIG = {
  path: "items.productId",
  select: "name slug basePrice mrp discount images variants isNewArrival isBestSeller status",
};

export const getWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    let wishlist = await Wishlist.findOne({ userId }).populate(POPULATE_CONFIG);

    if (!wishlist) {
      wishlist = await Wishlist.create({ userId, items: [] });
    }

    res.status(200).json({
      success: true,
      data: wishlist,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};

export const addItemToWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { productId } = req.params;
    // variantId is sent as a query param: POST /wishlist/items/:productId?variantId=xxx
    const variantId = (req.query.variantId as string) || null;

    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError("Product not found", 404, "NOT_FOUND");
    }

    let wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      wishlist = new Wishlist({ userId, items: [] });
    }

    // Check if this exact product+variant combo already exists
    const itemExists = wishlist.items.some((item) => {
      const sameProduct = item.productId.toString() === productId;
      if (!sameProduct) return false;
      // If both sides have a variantId, they must match; otherwise treat as duplicate
      if (variantId && item.variantId) return item.variantId === variantId;
      // No variantId on either side → duplicate product-level entry
      if (!variantId && !item.variantId) return true;
      return false;
    });

    if (!itemExists) {
      wishlist.items.push({
        productId: product._id as any,
        variantId: variantId ?? undefined,
        addedAt: new Date(),
      });
      await wishlist.save();
    }

    await wishlist.populate(POPULATE_CONFIG);

    res.status(200).json({
      success: true,
      data: wishlist,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};

export const removeItemFromWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { productId } = req.params;
    // variantId is sent as a query param: DELETE /wishlist/items/:productId?variantId=xxx
    const variantId = (req.query.variantId as string) || null;

    const wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      throw new AppError("Wishlist not found", 404, "NOT_FOUND");
    }

    wishlist.items = wishlist.items.filter((item) => {
      const sameProduct = item.productId.toString() === productId;
      if (!sameProduct) return true; // keep items for other products

      if (variantId) {
        // Remove only the matching variant; keep other variants of the same product
        return item.variantId !== variantId;
      } else {
        // No variantId specified → remove product-level entries (no variantId) only
        return !!item.variantId;
      }
    });

    await wishlist.save();

    await wishlist.populate(POPULATE_CONFIG);

    res.status(200).json({
      success: true,
      data: wishlist,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};

export const clearWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;

    const wishlist = await Wishlist.findOne({ userId });
    if (wishlist) {
      wishlist.items = [];
      await wishlist.save();
    }

    res.status(200).json({
      success: true,
      data: wishlist,
      code: "SUCCESS",
      errors: [],
    });
  } catch (error) {
    next(error);
  }
};
