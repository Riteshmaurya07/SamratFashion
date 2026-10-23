import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { Product, ProductStatus, IProductVariant } from "../models/Product";
import { AppError } from "../utils/AppError";
import { createCustomDesignSchema, createCustomPrintingRequestSchema, updateCustomDesignSchema } from "../utils/customDesignValidation";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const validatePrintableZones = (design: any, product: any) => {
  const sides = ['front', 'back', 'leftSleeve', 'rightSleeve'];
  
  for (const side of sides) {
    const elements = design[side]?.elements || [];
    if (elements.length === 0) continue;
    
    const zones = product.printableZones?.[side] || [];
    if (zones.length === 0 && elements.length > 0) {
      throw new AppError(`Product does not support printing on ${side}`, 400);
    }
    
    for (const el of elements) {
      const w = el.width * (el.scaleX || 1);
      const h = el.height * (el.scaleY || 1);
      const rad = ((el.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      
      // Calculate 4 corners based on top-left origin
      const corners = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: w, y: h }
      ].map(p => ({
        x: el.x + p.x * cos - p.y * sin,
        y: el.y + p.x * sin + p.y * cos
      }));
      
      const minX = Math.min(...corners.map(c => c.x));
      const maxX = Math.max(...corners.map(c => c.x));
      const minY = Math.min(...corners.map(c => c.y));
      const maxY = Math.max(...corners.map(c => c.y));
      
      let fitsInAtLeastOneZone = false;
      
      for (const zone of zones) {
        const zoneMinX = zone.x;
        const zoneMaxX = zone.x + zone.width;
        const zoneMinY = zone.y;
        const zoneMaxY = zone.y + zone.height;
        
        if (minX >= zoneMinX && maxX <= zoneMaxX && minY >= zoneMinY && maxY <= zoneMaxY) {
          fitsInAtLeastOneZone = true;
          break;
        }
      }
      
      if (!fitsInAtLeastOneZone) {
        throw new AppError(`Element on ${side} falls outside valid printable zones.`, 400);
      }
    }
  }
};

export const createDesign = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const validatedData = createCustomDesignSchema.parse(req.body);

    const product = await Product.findById(validatedData.productId);
    if (!product || product.status !== "ACTIVE") return next(new AppError("Target product is invalid or unavailable", 400));

    const variant = product.variants.find((v: any) => v._id?.toString() === validatedData.selectedVariantId);
    if (!variant) return next(new AppError("Selected product variant unavailable", 400));

    if (validatedData.design) {
      validatePrintableZones(validatedData.design, product);
    }

    const newDesign = await CustomDesign.create({
      ...validatedData,
      userId: req.user.id,
      productId: product._id,
      selectedVariantId: variant._id,
      status: "DRAFT",
      currentVersion: 1,
      versions: [
        {
          version: 1,
          design: validatedData.design,
          createdBy: req.user.id,
          createdAt: new Date(),
          status: "DRAFT"
        }
      ]
    });

    res.status(201).json({
      success: true,
      message: "Custom design saved successfully",
      data: newDesign,
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
      status: { $ne: "ARCHIVED" },
    }).populate("productId", "name slug basePrice mrp discount variants images");

    if (!design) {
      return next(new AppError("Custom design not found", 404));
    }

    // Authorization: non-admins must only see their own designs (return 404 not 403 to avoid existence leakage)
    if (design.userId.toString() !== req.user.id && req.user.role !== "ADMIN") {
      return next(new AppError("Custom design not found", 404));
    }

    // Call getter to adapt V1 logic if necessary
    const activeLayout = design.getActiveLayout();

    res.status(200).json({
      success: true,
      data: {
        ...design.toObject(),
        design: activeLayout // Re-inject adapted layout for UI
      },
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
      status: { $ne: "ARCHIVED" },
    });

    if (!design) return next(new AppError("Custom design not found", 404));

    if (design.userId.toString() !== req.user.id && req.user.role !== "ADMIN") {
      return next(new AppError("Unauthorized to modify this design", 403));
    }

    // Immutable approved versions guard
    if (design.approvedVersion && design.currentVersion === design.approvedVersion) {
      return next(new AppError("Cannot modify an approved version. Request a revision to unlock.", 403));
    }

    // Freeze modification if already linked to an order and not in DRAFT/SAVED
    if (design.orderId && !["DRAFT", "SAVED"].includes(design.status)) {
      return next(new AppError("Cannot modify a design that is already in processing. Request a revision.", 403));
    }

    if (validatedData.design) {
      const product = await Product.findById(design.productId);
      if (product) {
        validatePrintableZones(validatedData.design, product);
      }
    }

    const updatePayload: any = { $set: {} };
    if (validatedData.name) updatePayload.$set.name = validatedData.name;
    if (validatedData.selectedColor) updatePayload.$set.selectedColor = validatedData.selectedColor;
    if (validatedData.selectedVariantId) updatePayload.$set.selectedVariantId = new mongoose.Types.ObjectId(validatedData.selectedVariantId);

    // If design structure changed, increment version and snapshot atomically
    if (validatedData.design) {
      updatePayload.$set.design = validatedData.design;
      updatePayload.$inc = { currentVersion: 1 };
      updatePayload.$push = {
        versions: {
          version: design.currentVersion + 1,
          design: validatedData.design,
          createdBy: new mongoose.Types.ObjectId(req.user.id),
          createdAt: new Date(),
          status: design.status,
          previewUrls: [],
          artworkUrls: []
        }
      };
    }

    const updatedDesign = await CustomDesign.findOneAndUpdate(
      { _id: id, currentVersion: design.currentVersion }, // Optimistic lock
      updatePayload,
      { returnDocument: 'after' }
    );

    if (!updatedDesign) {
      return next(new AppError("Concurrency conflict. Design was modified by another request. Please retry.", 409));
    }

    res.status(200).json({
      success: true,
      message: "Custom design updated successfully",
      data: updatedDesign,
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

    const activeLayout = sourceDesign.getActiveLayout();

    const newDesign = await CustomDesign.create({
      userId: req.user.id,
      name: `${sourceDesign.name} (Copy)`,
      productId: sourceDesign.productId,
      selectedVariantId: sourceDesign.selectedVariantId,
      selectedColor: sourceDesign.selectedColor,
      selectedSize: sourceDesign.selectedSize,
      canvasWidth: sourceDesign.canvasWidth,
      canvasHeight: sourceDesign.canvasHeight,
      design: activeLayout,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          design: activeLayout,
          createdBy: req.user.id,
          createdAt: new Date(),
          status: "DRAFT"
        }
      ],
      previewImage: sourceDesign.previewImage,
      printLocations: sourceDesign.printLocations,
      status: "DRAFT",
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

// Customer Approval Workflow endpoints
export const approveDesign = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const design = await CustomDesign.findOne({ _id: req.params.id, userId: req.user.id });
    if (!design) return next(new AppError("Design not found or unauthorized", 404));

    if (design.status !== "CUSTOMER_REVIEW") {
      return next(new AppError("Design is not currently in review state.", 400));
    }

    design.status = "CUSTOMER_APPROVED";
    design.approvedVersion = design.currentVersion;
    design.approvedAt = new Date();
    design.approvedBy = new mongoose.Types.ObjectId(req.user.id);

    // Lock the current version in versions array
    const versionIndex = design.versions.findIndex(v => v.version === design.currentVersion);
    if (versionIndex > -1) {
      design.versions[versionIndex].status = "CUSTOMER_APPROVED";
    }

    await design.save();
    res.status(200).json({ success: true, message: "Design approved successfully.", data: design });
  } catch (error) {
    next(error);
  }
};

export const requestRevision = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return next(new AppError("Unauthorized", 401));

    const { comment } = req.body;
    if (!comment) return next(new AppError("Revision comment is required.", 400));

    const design = await CustomDesign.findOne({ _id: req.params.id, userId: req.user.id });
    if (!design) return next(new AppError("Design not found or unauthorized", 404));

    if (design.status !== "CUSTOMER_REVIEW" && design.status !== "CUSTOMER_APPROVED") {
      return next(new AppError("Invalid state transition for revision request.", 400));
    }

    const activeLayout = design.getActiveLayout();
    
    // We increment version atomically and create a new DRAFT
    const updatedDesign = await CustomDesign.findOneAndUpdate(
      { _id: req.params.id, currentVersion: design.currentVersion }, // Optimistic lock
      {
        $set: { status: "DRAFT" },
        $inc: { currentVersion: 1 },
        $push: {
          versions: {
            version: design.currentVersion + 1,
            design: activeLayout,
            createdBy: new mongoose.Types.ObjectId(req.user.id),
            createdAt: new Date(),
            status: "DRAFT", // New version is a DRAFT
            revisionComment: comment,
            previewUrls: [],
            artworkUrls: []
          }
        }
      },
      { returnDocument: 'after' }
    );

    if (!updatedDesign) {
      return next(new AppError("Concurrency conflict while requesting revision. Please retry.", 409));
    }

    res.status(200).json({ success: true, message: "Revision requested successfully. New draft version created.", data: updatedDesign });
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
      artworkType,
      designAssistanceName,
      designAssistanceEmail,
      artwork,
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
    if (!product) return next(new AppError("Customizable product not found or inactive", 404));

    const variant = product.variants.find((item: IProductVariant) => item._id?.toString() === selectedVariantId);
    if (!variant || !variant.isAvailable || variant.stock < 1) {
      return next(new AppError("Selected variant is unavailable", 400));
    }
    if (variant.color !== selectedColor || variant.size !== selectedSize) {
      return next(new AppError("Selected color and size do not match the variant", 400));
    }

    let catalogObjectId: mongoose.Types.ObjectId | undefined = undefined;
    if (catalogItemId && mongoose.Types.ObjectId.isValid(catalogItemId)) {
      catalogObjectId = new mongoose.Types.ObjectId(catalogItemId);
    }

    const formattedPlacements = Array.isArray(selectedPlacements)
      ? selectedPlacements
          .filter((p) => mongoose.Types.ObjectId.isValid(p.templateId))
          .map((p) => ({
            templateId: new mongoose.Types.ObjectId(p.templateId),
            code: p.code,
            name: p.name,
          }))
      : [];

    const resolvedArtworkType = artworkType || (artwork?.url ? "HAS_ARTWORK" : "NEEDS_DESIGN_ASSISTANCE");
    const designAssistance =
      resolvedArtworkType === "NEEDS_DESIGN_ASSISTANCE" || designAssistanceName || designAssistanceEmail
        ? {
            requested: true,
            name: designAssistanceName,
            email: designAssistanceEmail,
            instructions,
          }
        : undefined;

    const request = await CustomDesign.create({
      userId: req.user.id,
      name: `${product.name} custom request`,
      productId: product._id,
      selectedVariantId: variant._id,
      selectedColor,
      selectedSize,
      canvasWidth: 800,
      canvasHeight: 1000,
      elements: [],
      instructions,
      artwork,
      artworkType: resolvedArtworkType,
      designAssistance,
      catalogItemId: catalogObjectId,
      selectedPlacements: formattedPlacements,
      requestType: "PRINTING_REQUEST",
      submissionKey: idempotencyKey,
      printLocations: printLocations || ["FRONT"],
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
