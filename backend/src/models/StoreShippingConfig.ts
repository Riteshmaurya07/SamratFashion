import mongoose, { Document, Schema } from "mongoose";
import { AppError } from "../utils/AppError";

export const DEFAULT_SHIPPING_CONFIG_ID = new mongoose.Types.ObjectId("000000000000000000000001");
export const DEFAULT_SHIPPING_CONFIG_KEY = "default";

export interface IStoreShippingConfig extends Document {
  _id: mongoose.Types.ObjectId;
  key: string;
  globalFreeShippingThreshold: number;
  standardShippingFee: number;
  isGlobalFreeShippingActive: boolean;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const storeShippingConfigSchema = new Schema<IStoreShippingConfig>(
  {
    _id: {
      type: Schema.Types.ObjectId,
      default: () => DEFAULT_SHIPPING_CONFIG_ID,
    },
    key: {
      type: String,
      required: true,
      unique: true,
      default: DEFAULT_SHIPPING_CONFIG_KEY,
      index: true,
    },
    globalFreeShippingThreshold: {
      type: Number,
      required: true,
      default: 999,
      min: [0, "Global free shipping threshold cannot be negative"],
    },
    standardShippingFee: {
      type: Number,
      required: true,
      default: 100,
      min: [0, "Standard shipping fee cannot be negative"],
    },
    isGlobalFreeShippingActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export const StoreShippingConfig = mongoose.model<IStoreShippingConfig>(
  "StoreShippingConfig",
  storeShippingConfigSchema
);

export const SAFE_DEFAULT_SHIPPING_CONFIG = {
  globalFreeShippingThreshold: 999,
  standardShippingFee: 100,
  isGlobalFreeShippingActive: true,
} as const;

/**
 * Loads the singleton StoreShippingConfig.
 * Uses atomic upsert with $setOnInsert so concurrent initializations
 * never duplicate records, and existing admin settings are never overwritten.
 * If database query fails, FAILS CLOSED with a 500 AppError to prevent
 * accidental free delivery or unverified charges.
 */
export async function getStoreShippingConfig(): Promise<{
  _id?: mongoose.Types.ObjectId;
  globalFreeShippingThreshold: number;
  standardShippingFee: number;
  isGlobalFreeShippingActive: boolean;
  updatedBy?: mongoose.Types.ObjectId;
  updatedAt?: Date;
}> {
  try {
    const config = await StoreShippingConfig.findOneAndUpdate(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      {
        $setOnInsert: {
          _id: DEFAULT_SHIPPING_CONFIG_ID,
          key: DEFAULT_SHIPPING_CONFIG_KEY,
          globalFreeShippingThreshold: SAFE_DEFAULT_SHIPPING_CONFIG.globalFreeShippingThreshold,
          standardShippingFee: SAFE_DEFAULT_SHIPPING_CONFIG.standardShippingFee,
          isGlobalFreeShippingActive: SAFE_DEFAULT_SHIPPING_CONFIG.isGlobalFreeShippingActive,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    ).lean();

    if (config) {
      return {
        _id: config._id,
        globalFreeShippingThreshold: Number(config.globalFreeShippingThreshold ?? SAFE_DEFAULT_SHIPPING_CONFIG.globalFreeShippingThreshold),
        standardShippingFee: Number(config.standardShippingFee ?? SAFE_DEFAULT_SHIPPING_CONFIG.standardShippingFee),
        isGlobalFreeShippingActive: Boolean(config.isGlobalFreeShippingActive ?? SAFE_DEFAULT_SHIPPING_CONFIG.isGlobalFreeShippingActive),
        updatedBy: config.updatedBy,
        updatedAt: config.updatedAt,
      };
    }
  } catch (err: unknown) {
    // If concurrent initialization raced on initial upsert (code 11000), fetch the winning document cleanly
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000) {
      try {
        const existing = await StoreShippingConfig.findOne({ key: DEFAULT_SHIPPING_CONFIG_KEY }).lean();
        if (existing) {
          return {
            _id: existing._id,
            globalFreeShippingThreshold: Number(existing.globalFreeShippingThreshold ?? SAFE_DEFAULT_SHIPPING_CONFIG.globalFreeShippingThreshold),
            standardShippingFee: Number(existing.standardShippingFee ?? SAFE_DEFAULT_SHIPPING_CONFIG.standardShippingFee),
            isGlobalFreeShippingActive: Boolean(existing.isGlobalFreeShippingActive ?? SAFE_DEFAULT_SHIPPING_CONFIG.isGlobalFreeShippingActive),
            updatedBy: existing.updatedBy,
            updatedAt: existing.updatedAt,
          };
        }
      } catch (raceErr: unknown) {
        console.error("[SHIPPING CONFIG CRITICAL ERROR] Failed to resolve concurrent initialization race from DB:", raceErr);
      }
    }

    // On actual database failure, fail closed with structured logging; never silently calculate shipping with unverified fallbacks
    console.error("[SHIPPING CONFIG CRITICAL ERROR] Database query failed while loading StoreShippingConfig:", {
      error: err instanceof Error ? err.message : String(err),
      connectionReadyState: mongoose.connection.readyState,
    });

    throw new AppError(
      "Failed to retrieve store shipping configuration due to a database error. Please try again.",
      500,
      "SHIPPING_CONFIG_READ_ERROR"
    );
  }

  throw new AppError(
    "Store shipping configuration is unavailable. Please try again.",
    500,
    "SHIPPING_CONFIG_UNAVAILABLE"
  );
}
