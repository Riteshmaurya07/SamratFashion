import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { Product, ProductStatus } from "../models/Product";
import { PrintPlacementTemplate } from "../models/PrintPlacementTemplate";
import { AppError } from "../utils/AppError";
import { createCustomDesignSchema, createCustomPrintingRequestSchema, updateCustomDesignSchema } from "../utils/customDesignValidation";

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
      $or: [{ requestType: "DESIGN" }, { requestType: { $exists: false } }],
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

export const createCustomPrintingRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const parsed = createCustomPrintingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.issues[0]?.message || "Invalid custom printing request", 400));
    }

    const {
      productId,
      selectedVariantId,
      selectedColor,
      selectedSize,
      printLocations,
      selectedPlacements,
      instructions,
      artwork,
      artworkType,
      designAssistanceName,
      designAssistanceEmail,
      idempotencyKey,
      catalogItemId,
    } = parsed.data;

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(selectedVariantId)) {
      return next(new AppError("Invalid product or variant", 400));
    }

    if (idempotencyKey) {
      const existing = await CustomDesign.findOne({
        userId: req.user.id,
        submissionKey: idempotencyKey,
        requestType: "PRINTING_REQUEST",
      });
      if (existing) {
        return res.status(200).json({ success: true, duplicate: true, data: existing });
      }
    }

    const product = await Product.findOne({
      _id: productId,
      status: ProductStatus.ACTIVE,
      isCustomizable: true,
    });
    if (!product) return next(new AppError("Customizable product not found", 404));

    const variant = product.variants.find((item) => item._id?.toString() === selectedVariantId);
    if (!variant || !variant.isAvailable || variant.stock < 1) {
      return next(new AppError("Selected variant is unavailable", 400));
    }
    if (variant.color !== selectedColor || variant.size !== selectedSize) {
      return next(new AppError("Selected color and size do not match the variant", 400));
    }

    // Validate placements if provided
    let finalPlacements = selectedPlacements;
    if (finalPlacements && finalPlacements.length > 0) {
      const templateIds = finalPlacements.map((p) => p.templateId);
      const activeTemplates = await PrintPlacementTemplate.find({
        _id: { $in: templateIds },
        isActive: true,
      });

      if (activeTemplates.length !== templateIds.length) {
        return next(new AppError("One or more selected placements are invalid or inactive", 400));
      }
    }

    const request = await CustomDesign.create({
      userId: req.user.id,
      name: `${product.name} printing request`,
      productId: product._id,
      selectedVariantId: variant._id,
      selectedColor,
      selectedSize,
      canvasWidth: 800,
      canvasHeight: 1000,
      elements: [],
      instructions,
      artwork,
      artworkType: artworkType || (artwork ? "HAS_ARTWORK" : "NEEDS_DESIGN_ASSISTANCE"),
      designAssistance: (artworkType === "NEEDS_DESIGN_ASSISTANCE" || !artwork) ? {
        requested: true,
        name: designAssistanceName,
        email: designAssistanceEmail,
        instructions: instructions,
      } : undefined,
      requestType: "PRINTING_REQUEST",
      submissionKey: idempotencyKey,
      catalogItemId: catalogItemId && mongoose.Types.ObjectId.isValid(catalogItemId) ? catalogItemId : undefined,
      printLocations: printLocations || [],
      selectedPlacements: finalPlacements,
      status: "REQUESTED",
    });

    res.status(201).json({
      success: true,
      message: "Your custom printing request has been submitted.",
      data: request,
    });
  } catch (error) {
    next(error);
  }
};
