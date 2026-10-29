import mongoose from "mongoose";
import { Request, Response, NextFunction } from "express";
import { Wishlist } from "../models/Wishlist";
import { Product } from "../models/Product";
import { AppError } from "../utils/AppError";

const POPULATE_CONFIG = {
  path: "items.productId",
  select: "name slug basePrice mrp discount images variants isNewArrival isBestSeller status",
};
function extractProductId(productId: unknown): string {
  if (productId && typeof productId === "object" && "_id" in productId) {
    const candidate = productId._id;
    return String(candidate);
  }
  return String(productId);
}

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
      const itemProdId = extractProductId(item.productId);
      const sameProduct = itemProdId === productId;
      if (!sameProduct) return false;
      if (variantId && item.variantId) return item.variantId === variantId;
      if (!variantId && !item.variantId) return true;
      if (!variantId && item.variantId) return true;
      return false;
    });

    if (!itemExists) {
      wishlist.items.push({
        productId: product._id as unknown as mongoose.Types.ObjectId,
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
      const itemProdId = extractProductId(item.productId);
      const sameProduct = itemProdId === productId;
      if (!sameProduct) return true; // keep items for other products

      if (variantId) {
        // Remove only the matching variant; keep other variants of the same product
        return item.variantId !== variantId;
      } else {
        // No variantId specified → remove all entries for this product
        return false;
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
