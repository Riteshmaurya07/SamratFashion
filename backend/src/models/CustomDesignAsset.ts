import mongoose, { Document, Schema } from "mongoose";

export interface ICustomDesignAsset extends Document {
  userId: mongoose.Types.ObjectId;
  designId?: mongoose.Types.ObjectId;
  version?: number;
  type: "UPLOADED" | "AI_GENERATED" | "BACKGROUND_REMOVED" | "PREVIEW" | "PRODUCTION";
  side?: "FRONT" | "BACK" | "LEFT_SLEEVE" | "RIGHT_SLEEVE";
  originalUrl: string;
  processedUrl?: string;
  previewUrl?: string;
  productionUrl?: string;
  mimeType: string;
  width?: number;
  height?: number;
  fileSize: number;
  generatedAt?: Date; // Populated for PRODUCTION assets
  createdAt: Date;
}

const customDesignAssetSchema = new Schema<ICustomDesignAsset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    designId: { type: Schema.Types.ObjectId, ref: "CustomDesign", index: true },
    version: { type: Number },
    type: { 
      type: String, 
      enum: ["UPLOADED", "AI_GENERATED", "BACKGROUND_REMOVED", "PREVIEW", "PRODUCTION"], 
      required: true 
    },
    side: {
      type: String,
      enum: ["FRONT", "BACK", "LEFT_SLEEVE", "RIGHT_SLEEVE"]
    },
    originalUrl: { type: String, required: true },
    processedUrl: { type: String },
    previewUrl: { type: String },
    productionUrl: { type: String },
    mimeType: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    fileSize: { type: Number, required: true },
    generatedAt: { type: Date }, // Populated for PRODUCTION type assets
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

customDesignAssetSchema.index({ userId: 1, type: 1 });

// DB-level unique constraint: prevents duplicate production assets for the same
// immutable approved design version + side combination.
// Two concurrent generation requests cannot both succeed for the same (designId, version, side, type=PRODUCTION).
customDesignAssetSchema.index(
  { designId: 1, version: 1, side: 1, type: 1 },
  {
    unique: true,
    sparse: true, // Allows null designId/version/side for non-production assets
    partialFilterExpression: { type: "PRODUCTION" }, // Only enforce for PRODUCTION assets
    name: "unique_production_asset_per_version_side",
  }
);

export const CustomDesignAsset = mongoose.model<ICustomDesignAsset>("CustomDesignAsset", customDesignAssetSchema);
