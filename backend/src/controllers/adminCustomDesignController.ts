import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { AppError } from "../utils/AppError";
import { productionAssetService } from "../services/productionAssetService";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const getAdminCustomDesigns = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;
    const status = req.query.status as string;

    const query: any = { status: { $ne: "ARCHIVED" } };
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (status) query.status = status;

    const [designs, total] = await Promise.all([
      CustomDesign.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "name email")
        .populate("productId", "name slug basePrice")
        .populate("orderId", "orderNumber status paymentStatus"),
      CustomDesign.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: designs,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminCustomDesignById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid design ID format", 400));
    }

    const design = await CustomDesign.findOne({
      _id: id,
      status: { $ne: "ARCHIVED" },
    })
      .populate("userId", "name email")
      .populate("productId", "name slug basePrice")
      .populate("orderId", "orderNumber status paymentStatus");

    if (!design) {
      return next(new AppError("Custom design not found", 404));
    }

    const activeLayout = design.getActiveLayout();

    res.status(200).json({
      success: true,
      data: {
        ...design.toObject(),
        design: activeLayout
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminCustomDesignStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) return next(new AppError('Invalid design ID', 400));
    if (!status) return next(new AppError('Status is required', 400));

    const design = await CustomDesign.findById(id);
    if (!design) return next(new AppError('Custom design not found', 404));

    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['SUBMITTED'], 
      'SUBMITTED': ['PREVIEW_GENERATED', 'IN_PRODUCTION'], 
      'PREVIEW_GENERATED': ['CUSTOMER_REVIEW'], 
      'CUSTOMER_REVIEW': ['CUSTOMER_APPROVED', 'REVISION_REQUESTED'], 
      'CUSTOMER_APPROVED': ['PRODUCTION_VALIDATION'], 
      'PRODUCTION_VALIDATION': ['PRODUCTION_READY', 'REVISION_REQUESTED'],
      'PRODUCTION_READY': ['IN_PRODUCTION'],
      'REVISION_REQUESTED': ['DRAFT'], 
      'IN_PRODUCTION': ['COMPLETED'], // Admin finishes
      'COMPLETED': [] // Terminal state
    };

    const allowedNextStatuses = validTransitions[design.status] || [];
    
    if (!allowedNextStatuses.includes(status)) {
      return next(new AppError(`Invalid status transition from ${design.status} to ${status}`, 400));
    }

    // Additional guard: PRODUCTION_VALIDATION requires an approvedVersion
    if (status === 'PRODUCTION_VALIDATION' && !design.approvedVersion) {
      return next(new AppError('Cannot enter PRODUCTION_VALIDATION: design has no approved version', 400));
    }

    design.status = status;
    await design.save();

    res.status(200).json({
      success: true,
      data: design,
      message: `Custom design status updated to ${status}`
    });
  } catch (error) {
    next(error);
  }
};

export const generateProductionAssets = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) return next(new AppError('Invalid design ID', 400));

    const design = await CustomDesign.findById(id);
    if (!design) return next(new AppError('Custom design not found', 404));

    if (!design.approvedVersion) {
      return next(new AppError('Cannot generate assets: no approved version exists', 400));
    }

    // Only allowed from PRODUCTION_VALIDATION status
    if (design.status !== 'PRODUCTION_VALIDATION') {
      return next(new AppError(`Cannot generate assets from status ${design.status}. Must be PRODUCTION_VALIDATION.`, 400));
    }

    try {
      const assets = await productionAssetService.generateProductionAssets(design, design.approvedVersion);

      // Only transition to PRODUCTION_READY on actual success
      design.status = 'PRODUCTION_READY';
      await design.save();

      res.status(200).json({
        success: true,
        data: assets,
        message: 'Production assets generated successfully'
      });
    } catch (renderError: any) {
      // Gracefully handle the unavailable renderer without corrupting status
      if (renderError.statusCode === 501 || renderError.message === 'PRODUCTION_ASSET_GENERATION_UNAVAILABLE') {
        return res.status(501).json({
          success: false,
          status: 'PRODUCTION_ASSET_GENERATION_UNAVAILABLE',
          message: 'Production rendering is not yet configured on this server. Status unchanged.',
          designStatus: design.status,
        });
      }
      throw renderError;
    }
  } catch (error) {
    next(error);
  }
};
