import mongoose, { Document, Schema } from "mongoose";

export interface IPreviewConfig {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IPrintPlacementTemplate extends Document {
  name: string;
  code: string;
  side: string;
  description?: string;
  imageUrl: string;
  previewConfig: IPreviewConfig;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const previewConfigSchema = new Schema<IPreviewConfig>(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false }
);

const printPlacementTemplateSchema = new Schema<IPrintPlacementTemplate>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, unique: true },
    side: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String, required: true, trim: true },
    previewConfig: { type: previewConfigSchema, required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const PrintPlacementTemplate = mongoose.model<IPrintPlacementTemplate>(
  "PrintPlacementTemplate",
  printPlacementTemplateSchema
);
