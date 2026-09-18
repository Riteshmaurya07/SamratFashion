import mongoose from "mongoose";
import { CustomDesignAsset } from "../models/CustomDesignAsset";
import { AppError } from "../utils/AppError";

export class AssetService {
  /**
   * Validate that an asset exists, belongs to the correct user, and is tied to the correct design/version if applicable.
   */
  static async validateAssetOwnership(
    assetId: string,
    userId: string,
    expectedDesignId?: string,
    expectedVersion?: number
  ): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(assetId)) {
      throw new AppError("Invalid asset ID format", 400);
    }

    const asset = await CustomDesignAsset.findById(assetId);
    if (!asset) {
      throw new AppError("Asset not found", 404);
    }

    if (asset.userId.toString() !== userId.toString()) {
      throw new AppError("Unauthorized access to asset", 403);
    }

    if (expectedDesignId && asset.designId && asset.designId.toString() !== expectedDesignId.toString()) {
      throw new AppError("Asset is bound to a different design", 403);
    }

    if (expectedVersion !== undefined && asset.version !== undefined && asset.version !== expectedVersion) {
      throw new AppError("Asset is bound to a different design version", 403);
    }

    return true;
  }

  /**
   * Register a new asset tied to a specific design version.
   */
  static async registerAsset(
    userId: string,
    type: "UPLOADED" | "AI_GENERATED" | "BACKGROUND_REMOVED" | "PREVIEW" | "PRODUCTION",
    originalUrl: string,
    mimeType: string,
    fileSize: number,
    designId?: string,
    version?: number,
    dimensions?: { width: number; height: number }
  ) {
    const asset = await CustomDesignAsset.create({
      userId: new mongoose.Types.ObjectId(userId),
      designId: designId ? new mongoose.Types.ObjectId(designId) : undefined,
      version,
      type,
      originalUrl,
      mimeType,
      fileSize,
      width: dimensions?.width,
      height: dimensions?.height,
    });

    return asset;
  }

  /**
   * Register a production asset for a specific design version and side.
   *
   * Enforces application-level immutability: throws if a production asset for
   * the same (designId, version, side) already exists.
   * The DB-level unique index provides a second safety net for concurrent requests.
   */
  static async registerProductionAsset(params: {
    userId: string;
    designId: string;
    version: number;
    side: "FRONT" | "BACK" | "LEFT_SLEEVE" | "RIGHT_SLEEVE";
    url: string;
    mimeType: string;
    fileSize: number;
    width: number;
    height: number;
  }) {
    const { userId, designId, version, side, url, mimeType, fileSize, width, height } = params;

    // Application-level immutability check (DB unique index is the second safety net)
    const existing = await CustomDesignAsset.findOne({
      designId: new mongoose.Types.ObjectId(designId),
      version,
      side,
      type: "PRODUCTION",
    });

    if (existing) {
      throw new AppError(
        `Production asset for design ${designId} version ${version} side ${side} already exists. ` +
        `Approved version assets are immutable and cannot be overwritten.`,
        409,
        "PRODUCTION_ASSET_ALREADY_EXISTS"
      );
    }

    const asset = await CustomDesignAsset.create({
      userId: new mongoose.Types.ObjectId(userId),
      designId: new mongoose.Types.ObjectId(designId),
      version,
      side,
      type: "PRODUCTION",
      originalUrl: url,
      mimeType,
      fileSize,
      width,
      height,
      generatedAt: new Date(),
    });

    return asset;
  }
}
