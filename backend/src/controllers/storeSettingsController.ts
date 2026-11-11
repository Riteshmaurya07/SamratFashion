import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AuditLog } from '../models/AuditLog';
import { StoreSettings } from '../models/StoreSettings';
import { AppError } from '../utils/AppError';
import {
  getStoreSettings,
  saveStoreSettings,
} from '../services/storeSettingsService';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const storeSettingsSchema = z.object({
  freeShippingThreshold: z
    .number()
    .min(0, 'Free delivery threshold cannot be negative')
    .max(1_000_000, 'Free delivery threshold is too large'),
  standardShippingFee: z
    .number()
    .min(0, 'Delivery fee cannot be negative')
    .max(100_000, 'Delivery fee is too large'),
});

/**
 * GET /api/store-settings
 * Public read-only payload used by storefront marketing copy and cart nudges.
 */
export const getPublicStoreSettings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const settings = await getStoreSettings();
    res.status(200).json({
      success: true,
      data: {
        ...settings,
        currency: 'INR',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/settings
 */
export const getAdminStoreSettings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const settings = await getStoreSettings();
    res.status(200).json({
      success: true,
      data: {
        ...settings,
        currency: 'INR',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/settings
 * Updates the singleton settings document and records an audit trail.
 */
export const updateAdminStoreSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const parsed = storeSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues[0]?.message || 'Invalid store settings payload',
        400,
        'VALIDATION_ERROR'
      );
    }

    const previous = await getStoreSettings();
    const settings = {
      freeShippingThreshold: Math.round(parsed.data.freeShippingThreshold * 100) / 100,
      standardShippingFee: Math.round(parsed.data.standardShippingFee * 100) / 100,
    };

    const saved = await saveStoreSettings(settings, req.user?.id);
    const doc = await StoreSettings.findOne({ key: 'default' });

    if (doc) {
      await AuditLog.create({
        actorId: req.user?.id,
        actorRole: req.user?.role || 'ADMIN',
        action: 'ADMIN_STORE_SETTINGS_UPDATED',
        entityType: 'StoreSettings',
        entityId: doc._id,
        metadata: {
          previous,
          updated: saved,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Store settings saved successfully.',
      data: {
        ...saved,
        currency: 'INR',
      },
    });
  } catch (error) {
    next(error);
  }
};
