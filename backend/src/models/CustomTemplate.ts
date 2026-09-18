import mongoose, { Document, Schema } from "mongoose";

export interface IDesignElement {
  id: string;
  type: "TEXT" | "IMAGE" | "SHAPE";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  locked: boolean;
  zIndex: number;
  properties: Record<string, unknown>;
}

export interface IDesignLayout {
  front: { elements: IDesignElement[] };
  back: { elements: IDesignElement[] };
  leftSleeve: { elements: IDesignElement[] };
  rightSleeve: { elements: IDesignElement[] };
}

export interface ICustomTemplate extends Document {
  name: string;
  category: string;
  tags: string[];
  design: IDesignLayout;
  thumbnailUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const designElementSchema = new Schema<IDesignElement>(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ["TEXT", "IMAGE", "SHAPE"], required: true },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    rotation: { type: Number, default: 0 },
    scaleX: { type: Number, default: 1 },
    scaleY: { type: Number, default: 1 },
    opacity: { type: Number, default: 1 },
    locked: { type: Boolean, default: false },
    zIndex: { type: Number, default: 0 },
    properties: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const designLayoutSchema = new Schema<IDesignLayout>(
  {
    front: { elements: { type: [designElementSchema], default: [] } },
    back: { elements: { type: [designElementSchema], default: [] } },
    leftSleeve: { elements: { type: [designElementSchema], default: [] } },
    rightSleeve: { elements: { type: [designElementSchema], default: [] } },
  },
  { _id: false }
);

const customTemplateSchema = new Schema<ICustomTemplate>(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    tags: [{ type: String, trim: true }],
    design: { type: designLayoutSchema, required: true, default: () => ({ front: { elements: [] }, back: { elements: [] }, leftSleeve: { elements: [] }, rightSleeve: { elements: [] } }) },
    thumbnailUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

customTemplateSchema.index({ isActive: 1 });
customTemplateSchema.index({ category: 1 });
customTemplateSchema.index({ tags: 1 });

export const CustomTemplate = mongoose.model<ICustomTemplate>("CustomTemplate", customTemplateSchema);
// Export reusable sub-schemas for CustomDesign
export { designLayoutSchema, designElementSchema };
