import { Request, Response, NextFunction } from "express";
import { Wishlist } from "../models/Wishlist";
import { Product } from "../models/Product";
import { AppError } from "../utils/AppError";

export const getWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    let wishlist = await Wishlist.findOne({ userId }).populate({
      path: "items.productId",
      select: "name slug basePrice mrp discount images variants isNewArrival isBestSeller status",
    });

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

    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError("Product not found", 404, "NOT_FOUND");
    }

    let wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      wishlist = new Wishlist({ userId, items: [] });
    }

    const itemExists = wishlist.items.some((item) => item.productId.toString() === productId);
    if (!itemExists) {
      wishlist.items.push({
        productId: product._id as any,
        addedAt: new Date(),
      });
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

export const removeItemFromWishlist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { productId } = req.params;

    const wishlist = await Wishlist.findOne({ userId });
    if (!wishlist) {
      throw new AppError("Wishlist not found", 404, "NOT_FOUND");
    }

    wishlist.items = wishlist.items.filter((item) => item.productId.toString() !== productId);
    await wishlist.save();

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
