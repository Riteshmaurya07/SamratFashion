import mongoose, { Document, Schema } from "mongoose";
import { IDesignLayout, designLayoutSchema, IDesignElement } from "./CustomTemplate";

export type CustomRequestType = "DESIGN" | "PRINTING_REQUEST";
export type CustomRequestArtworkType = "HAS_ARTWORK" | "NEEDS_DESIGN_ASSISTANCE";

export interface IDesignVersion {
  version: number;
  design: IDesignLayout;
  previewUrls: string[];
  artworkUrls: string[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  status: "DRAFT" | "SUBMITTED" | "PREVIEW_GENERATED" | "CUSTOMER_REVIEW" | "CUSTOMER_APPROVED" | "REVISION_REQUESTED" | "PRODUCTION_VALIDATION" | "PRODUCTION_READY" | "IN_PRODUCTION" | "COMPLETED";
  revisionComment?: string;
}

export interface ICustomDesign extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  productId: mongoose.Types.ObjectId;
  selectedVariantId: mongoose.Types.ObjectId;
  selectedColor: string;
  selectedSize: string; // Kept for legacy compatibility
  canvasWidth: number;
  canvasHeight: number;
  // V1 Legacy field - kept for backward compatibility and migration
  elements?: any[]; 
  
  // V2 fields
  design?: IDesignLayout;
  versions: IDesignVersion[];
  currentVersion: number;
  approvedVersion?: number;
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  status: "DRAFT" | "SAVED" | "ORDERED" | "ARCHIVED" | "REQUESTED" | "SUBMITTED" | "PREVIEW_GENERATED" | "CUSTOMER_REVIEW" | "CUSTOMER_APPROVED" | "REVISION_REQUESTED" | "PRODUCTION_VALIDATION" | "PRODUCTION_READY" | "IN_PRODUCTION" | "COMPLETED";
  
  previewImage?: {
    front?: string;
    back?: string;
  };
  artwork?: {
    url: string;
    publicId?: string;
    format?: string;
  };
  instructions?: string;
  requestType: CustomRequestType;
  artworkType?: CustomRequestArtworkType;
  submissionKey?: string;
  printLocations: ("FRONT" | "BACK" | "LEFT_SLEEVE" | "RIGHT_SLEEVE")[];
  catalogItemId?: mongoose.Types.ObjectId;
  selectedPlacements?: {
    templateId: mongoose.Types.ObjectId;
    code: string;
    name: string;
  }[];
  designAssistance?: {
    requested: boolean;
    name?: string;
    email?: string;
    instructions?: string;
  };
  
  
  // Link to checkout/order
  orderId?: mongoose.Types.ObjectId;
  orderItemId?: mongoose.Types.ObjectId;
  
  createdAt: Date;
  updatedAt: Date;

  // Method to get the active layout, abstracting V1/V2 differences
  getActiveLayout(): IDesignLayout;
}

const selectedPlacementSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: "PrintPlacementTemplate", required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false }
);

const designVersionSchema = new Schema<IDesignVersion>(
  {
    version: { type: Number, required: true },
    design: { type: designLayoutSchema, required: true },
    previewUrls: { type: [String], default: [] },
    artworkUrls: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "PREVIEW_GENERATED", "CUSTOMER_REVIEW", "CUSTOMER_APPROVED", "REVISION_REQUESTED", "PRODUCTION_VALIDATION", "PRODUCTION_READY", "IN_PRODUCTION", "COMPLETED"],
      default: "DRAFT",
    },
    revisionComment: { type: String, trim: true },
  },
  { _id: false }
);

const customDesignSchema = new Schema<ICustomDesign>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    selectedVariantId: { type: Schema.Types.ObjectId, required: true },
    selectedColor: { type: String, required: true, trim: true },
    selectedSize: { type: String, default: "" }, // Made default empty string so it doesn't break if missing on V2 multi-size
    canvasWidth: { type: Number, default: 800 },
    canvasHeight: { type: Number, default: 1000 },
    elements: { type: [Schema.Types.Mixed], required: false }, // V1 Legacy
    design: { type: designLayoutSchema, required: false }, // V2
    versions: { type: [designVersionSchema], default: [] },
    currentVersion: { type: Number, default: 1 },
    approvedVersion: { type: Number },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    previewImage: {
      front: { type: String },
      back: { type: String },
    },
    artwork: {
      url: { type: String, trim: true },
      publicId: { type: String, trim: true },
      format: { type: String, trim: true },
    },
    instructions: { type: String, trim: true, maxlength: 2000 },
    requestType: {
      type: String,
      enum: ["DESIGN", "PRINTING_REQUEST"],
      default: "DESIGN",
      required: true,
    },
    artworkType: {
      type: String,
      enum: ["HAS_ARTWORK", "NEEDS_DESIGN_ASSISTANCE"],
    },
    submissionKey: { type: String, trim: true },
    catalogItemId: { type: Schema.Types.ObjectId, ref: "CustomPrintCatalogItem", default: undefined },
    printLocations: [{ type: String, enum: ["FRONT", "BACK", "LEFT_SLEEVE", "RIGHT_SLEEVE"], default: "FRONT" }],
    selectedPlacements: { type: [selectedPlacementSchema], default: undefined },
    designAssistance: {
      requested: { type: Boolean, default: false },
      name: { type: String, trim: true },
      email: { type: String, trim: true },
      instructions: { type: String, trim: true },
    },
    status: {
      type: String,
      enum: ["DRAFT", "SAVED", "ORDERED", "ARCHIVED", "REQUESTED", "SUBMITTED", "PREVIEW_GENERATED", "CUSTOMER_REVIEW", "CUSTOMER_APPROVED", "REVISION_REQUESTED", "PRODUCTION_VALIDATION", "PRODUCTION_READY", "IN_PRODUCTION", "COMPLETED"],
      default: "SAVED",
      required: true,
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    orderItemId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);

customDesignSchema.index({ userId: 1, createdAt: -1 });
customDesignSchema.index({ userId: 1, submissionKey: 1 }, { unique: true, sparse: true });
customDesignSchema.index({ status: 1 });

// Read adapter for V1 -> V2 migration in memory
customDesignSchema.methods.getActiveLayout = function (): IDesignLayout {
  if (this.design) {
    return this.design;
  }
  
  // Fallback to empty if no legacy elements
  const fallback: IDesignLayout = {
    front: { elements: [] },
    back: { elements: [] },
    leftSleeve: { elements: [] },
    rightSleeve: { elements: [] },
  };

  if (!this.elements || this.elements.length === 0) {
    return fallback;
  }

  // Migrate V1 legacy elements
  this.elements.forEach((el: any) => {
    const v2Element: IDesignElement = {
      id: el.id || new mongoose.Types.ObjectId().toString(),
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation || 0,
      scaleX: el.scale || 1,
      scaleY: el.scale || 1,
      opacity: el.opacity || 1,
      locked: false,
      zIndex: el.zIndex || 0,
      properties: {
        text: el.text,
        fontFamily: el.fontFamily,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        color: el.color,
        alignment: el.alignment,
        imageUrl: el.imageUrl,
        shapeType: el.shapeType,
        fillColor: el.fillColor,
        strokeColor: el.strokeColor,
        strokeWidth: el.strokeWidth,
      },
    };

    if (el.side === "BACK") {
      fallback.back.elements.push(v2Element);
    } else {
      fallback.front.elements.push(v2Element);
    }
  });

  return fallback;
};

export const CustomDesign = mongoose.model<ICustomDesign>("CustomDesign", customDesignSchema);
