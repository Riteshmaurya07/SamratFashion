import mongoose, { Document, Schema } from "mongoose";

export interface IDesignElement {
  id: string;
  type: "TEXT" | "IMAGE" | "SHAPE" | "LOGO";
  side: "FRONT" | "BACK";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  zIndex: number;
  opacity: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  alignment?: "left" | "center" | "right";
  imageUrl?: string;
  shapeType?: "RECTANGLE" | "CIRCLE" | "STAR" | "LINE";
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export type CustomRequestType = "DESIGN" | "PRINTING_REQUEST";
export type CustomRequestArtworkType = "HAS_ARTWORK" | "NEEDS_DESIGN_ASSISTANCE";

export interface ICustomDesign extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  productId: mongoose.Types.ObjectId;
  selectedVariantId: mongoose.Types.ObjectId;
  selectedColor: string;
  selectedSize: string;
  canvasWidth: number;
  canvasHeight: number;
  elements: IDesignElement[];
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
  printLocations: ("FRONT" | "BACK")[];
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
  status: "DRAFT" | "SAVED" | "ORDERED" | "ARCHIVED" | "REQUESTED";
  createdAt: Date;
  updatedAt: Date;
}

const selectedPlacementSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: "PrintPlacementTemplate", required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false }
);

const designElementSchema = new Schema<IDesignElement>(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ["TEXT", "IMAGE", "SHAPE", "LOGO"], required: true },
    side: { type: String, enum: ["FRONT", "BACK"], default: "FRONT", required: true },
    x: { type: Number, required: true, default: 0 },
    y: { type: Number, required: true, default: 0 },
    width: { type: Number, required: true, default: 100 },
    height: { type: Number, required: true, default: 100 },
    rotation: { type: Number, default: 0 },
    scale: { type: Number, default: 1 },
    zIndex: { type: Number, default: 0 },
    opacity: { type: Number, default: 1 },
    text: { type: String },
    fontFamily: { type: String },
    fontSize: { type: Number },
    fontWeight: { type: String },
    color: { type: String },
    alignment: { type: String, enum: ["left", "center", "right"] },
    imageUrl: { type: String },
    shapeType: { type: String, enum: ["RECTANGLE", "CIRCLE", "STAR", "LINE"] },
    fillColor: { type: String },
    strokeColor: { type: String },
    strokeWidth: { type: Number },
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
    selectedSize: { type: String, required: true, trim: true },
    canvasWidth: { type: Number, default: 800 },
    canvasHeight: { type: Number, default: 1000 },
    elements: { type: [designElementSchema], default: [] },
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
    printLocations: [{ type: String, enum: ["FRONT", "BACK"], default: "FRONT" }],
    selectedPlacements: { type: [selectedPlacementSchema], default: undefined },
    designAssistance: {
      requested: { type: Boolean, default: false },
      name: { type: String, trim: true },
      email: { type: String, trim: true },
      instructions: { type: String, trim: true },
    },
    status: {
      type: String,
      enum: ["DRAFT", "SAVED", "ORDERED", "ARCHIVED", "REQUESTED"],
      default: "SAVED",
      required: true,
    },
  },
  { timestamps: true }
);

customDesignSchema.index({ userId: 1, createdAt: -1 });
customDesignSchema.index({ userId: 1, submissionKey: 1 }, { unique: true, sparse: true });

export const CustomDesign = mongoose.model<ICustomDesign>("CustomDesign", customDesignSchema);
