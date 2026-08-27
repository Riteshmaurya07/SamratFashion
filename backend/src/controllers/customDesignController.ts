import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { Product } from "../models/Product";
import { AppError } from "../utils/AppError";
import { createCustomDesignSchema, updateCustomDesignSchema } from "../utils/customDesignValidation";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const createDesign = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const validatedData = createCustomDesignSchema.parse(req.body);

    // Verify target product exists and is ACTIVE
    const product = await Product.findById(validatedData.productId);
    if (!product || product.status !== "ACTIVE") return next(new AppError("Target product is invalid or unavailable", 400));

    const variant = product.variants.find((v: any) => v._id?.toString() === validatedData.selectedVariantId);
    if (!variant) return next(new AppError("Selected product variant unavailable", 400));

    const design = await CustomDesign.create({
      ...validatedData,
      userId: req.user.id,
      productId: product._id,
      selectedVariantId: variant._id,
      status: "SAVED",
    });

    res.status(201).json({
      success: true,
      message: "Custom design saved successfully",
      data: design,
    });
  } catch (error) {
    next(error);
  }
};

export const getUserDesigns = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const designs = await CustomDesign.find({
      userId: req.user.id,
      status: { $ne: "ARCHIVED" },
    })
      .sort({ updatedAt: -1 })
      .populate("productId", "name slug basePrice images");

    res.status(200).json({
      success: true,
      data: designs,
    });
  } catch (error) {
    next(error);
  }
};

export const getDesignById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid design ID format", 400));
    }

    const design = await CustomDesign.findOne({
      _id: id,
      userId: req.user.id,
      status: { $ne: "ARCHIVED" },
    }).populate("productId", "name slug basePrice mrp discount variants images");

    if (!design) {
      return next(new AppError("Custom design not found or unauthorized", 404));
    }

    res.status(200).json({
      success: true,
      data: design,
    });
  } catch (error) {
    next(error);
  }
};

export const updateDesign = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid design ID format", 400));
    }

    const validatedData = updateCustomDesignSchema.parse(req.body);

    const design = await CustomDesign.findOne({
      _id: id,
      userId: req.user.id,
      status: { $ne: "ARCHIVED" },
    });

    if (!design) {
      return next(new AppError("Custom design not found or unauthorized", 404));
    }

    // Update allowed fields
    Object.assign(design, validatedData);
    await design.save();

    res.status(200).json({
      success: true,
      message: "Custom design updated successfully",
      data: design,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteDesign = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid design ID format", 400));
    }

    const design = await CustomDesign.findOne({
      _id: id,
      userId: req.user.id,
    });

    if (!design) {
      return next(new AppError("Custom design not found or unauthorized", 404));
    }

    // Soft delete / archive to ensure historical cart/order integrity
    design.status = "ARCHIVED";
    await design.save();

    res.status(200).json({
      success: true,
      message: "Custom design deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const duplicateDesign = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid design ID format", 400));
    }

    const sourceDesign = await CustomDesign.findOne({
      _id: id,
      userId: req.user.id,
      status: { $ne: "ARCHIVED" },
    });

    if (!sourceDesign) {
      return next(new AppError("Source custom design not found or unauthorized", 404));
    }

    const newDesign = await CustomDesign.create({
      userId: req.user.id,
      name: `${sourceDesign.name} (Copy)`,
      productId: sourceDesign.productId,
      selectedVariantId: sourceDesign.selectedVariantId,
      selectedColor: sourceDesign.selectedColor,
      selectedSize: sourceDesign.selectedSize,
      canvasWidth: sourceDesign.canvasWidth,
      canvasHeight: sourceDesign.canvasHeight,
      elements: sourceDesign.elements,
      previewImage: sourceDesign.previewImage,
      printLocations: sourceDesign.printLocations,
      status: "SAVED",
    });

    res.status(201).json({
      success: true,
      message: "Custom design duplicated successfully",
      data: newDesign,
    });
  } catch (error) {
    next(error);
  }
};
