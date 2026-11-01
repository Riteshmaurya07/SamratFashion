import { Request, Response, NextFunction } from "express";
import {
  StoreShippingConfig,
  getStoreShippingConfig,
  DEFAULT_SHIPPING_CONFIG_KEY,
  DEFAULT_SHIPPING_CONFIG_ID,
} from "../models/StoreShippingConfig";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";
import mongoose from "mongoose";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const getAdminShippingSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const config = await getStoreShippingConfig();
    res.status(200).json({
      success: true,
      data: config,
      code: "SUCCESS",
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminShippingSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      globalFreeShippingThreshold,
      standardShippingFee,
      isGlobalFreeShippingActive,
    } = req.body;

    const thresholdNum = Number(globalFreeShippingThreshold);
    if (!Number.isFinite(thresholdNum) || thresholdNum < 0) {
      return next(
        new AppError(
          "Global free shipping threshold must be a non-negative number",
          400
        )
      );
    }

    const feeNum = Number(standardShippingFee);
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      return next(
        new AppError("Standard shipping fee must be a non-negative number", 400)
      );
    }

    if (typeof isGlobalFreeShippingActive !== "boolean") {
      return next(
        new AppError(
          "isGlobalFreeShippingActive must be a boolean (true or false)",
          400
        )
      );
    }

    const current = await getStoreShippingConfig();

    const updated = await StoreShippingConfig.findOneAndUpdate(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      {
        $set: {
          globalFreeShippingThreshold: Math.round(thresholdNum),
          standardShippingFee: Math.round(feeNum),
          isGlobalFreeShippingActive,
          updatedBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
        },
        $setOnInsert: {
          _id: DEFAULT_SHIPPING_CONFIG_ID,
          key: DEFAULT_SHIPPING_CONFIG_KEY,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    // Record in AuditLog
    if (req.user) {
      await AuditLog.create({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "ADMIN_SHIPPING_SETTINGS_UPDATED",
        entityType: "STORE_SHIPPING_CONFIG",
        entityId: updated._id,
        metadata: {
          previous: {
            globalFreeShippingThreshold: current.globalFreeShippingThreshold,
            standardShippingFee: current.standardShippingFee,
            isGlobalFreeShippingActive: current.isGlobalFreeShippingActive,
          },
          updated: {
            globalFreeShippingThreshold: updated.globalFreeShippingThreshold,
            standardShippingFee: updated.standardShippingFee,
            isGlobalFreeShippingActive: updated.isGlobalFreeShippingActive,
          },
        },
      });
    }

    res.status(200).json({
      success: true,
      data: updated,
      message: "Shipping settings updated successfully",
      code: "SUCCESS",
    });
  } catch (error) {
    next(error);
  }
};
