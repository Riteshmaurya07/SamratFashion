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
  printLocations: ("FRONT" | "BACK")[];
  status: "DRAFT" | "SAVED" | "ORDERED" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
}

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
    elements: [designElementSchema],
    previewImage: {
      front: { type: String },
      back: { type: String },
    },
    printLocations: [{ type: String, enum: ["FRONT", "BACK"], default: "FRONT" }],
    status: {
      type: String,
      enum: ["DRAFT", "SAVED", "ORDERED", "ARCHIVED"],
      default: "SAVED",
      required: true,
    },
  },
  { timestamps: true }
);

customDesignSchema.index({ userId: 1, createdAt: -1 });

export const CustomDesign = mongoose.model<ICustomDesign>("CustomDesign", customDesignSchema);
