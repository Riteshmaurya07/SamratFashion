import mongoose, { Document, Schema } from "mongoose";

export enum ProductStatus {
  DRAFT = "DRAFT",
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  ARCHIVED = "ARCHIVED",
}

export interface IProductVariant {
  _id?: mongoose.Types.ObjectId;
  size?: string;
  color?: string;
  hexCode?: string;
  sku: string;
  stock: number;
  additionalPrice: number;
  images: string[];
  isAvailable: boolean;
}

export enum ProductFit {
  OVERSIZED = "OVERSIZED",
  RELAXED = "RELAXED",
  REGULAR = "REGULAR",
  BOXER = "BOXER",
}

export enum ProductGender {
  UNISEX = "UNISEX",
  MEN = "MEN",
  WOMEN = "WOMEN",
}

export enum ProductPrintType {
  DTG = "DTG",
  PU_PRINT = "PU_PRINT",
  EMBROIDERY = "EMBROIDERY",
  SCREEN_PRINT = "SCREEN_PRINT",
}

export interface ISizeGuideRow {
  size: string;
  chest?: number;
  length?: number;
  shoulder?: number;
}

export interface IProductVariant {
  _id?: mongoose.Types.ObjectId;
  size?: string;
  color?: string;
  hexCode?: string;
  sku: string;
  stock: number;
  reorderThreshold?: number;
  warehouseLocation?: string;
  additionalPrice: number;
  images: string[];
  isAvailable: boolean;
}

export interface IProductOffer {
  type: string;
  description: string;
}

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  images: string[];
  categoryId: mongoose.Types.ObjectId; // One-to-many relationship as typical for apparel
  themeIds: mongoose.Types.ObjectId[]; // Many-to-many relationship
  basePrice: number;
  mrp?: number;
  discount?: number;
  variants: IProductVariant[];
  tags: string[];
  status: ProductStatus;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  averageRating: number;
  reviewCount: number;
  offers: IProductOffer[];
  fabric?: string;
  gsm?: number;
  fit?: ProductFit;
  gender?: ProductGender;
  careInstructions?: string[];
  printTypes?: ProductPrintType[];
  sizeGuideTable?: ISizeGuideRow[];
  seo: {
    title?: string;
    description?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const productVariantSchema = new Schema<IProductVariant>({
  size: { type: String, trim: true },
  color: { type: String, trim: true },
  hexCode: { type: String, trim: true },
  sku: { type: String, required: true, trim: true },
  stock: { type: Number, required: true, default: 0, min: 0 },
  reorderThreshold: { type: Number, default: 5, min: 0 },
  warehouseLocation: { type: String, trim: true },
  additionalPrice: { type: Number, default: 0, min: 0 },
  images: [{ type: String }],
  isAvailable: { type: Boolean, default: true },
});

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, required: true },
    images: [{ type: String }],
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    themeIds: [{ type: Schema.Types.ObjectId, ref: "Theme" }],
    basePrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, min: 0 },
    discount: { type: Number, min: 0, max: 100 },
    variants: [productVariantSchema],
    tags: [{ type: String, trim: true }],
    status: { type: String, enum: Object.values(ProductStatus), default: ProductStatus.DRAFT },
    isFeatured: { type: Boolean, default: false },
    isNewArrival: { type: Boolean, default: false },
    isBestSeller: { type: Boolean, default: false },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    offers: [{
      type: { type: String, trim: true },
      description: { type: String, trim: true }
    }],
    fabric: { type: String, trim: true },
    gsm: { type: Number, min: 0 },
    fit: { type: String, enum: Object.values(ProductFit) },
    gender: { type: String, enum: Object.values(ProductGender) },
    careInstructions: [{ type: String, trim: true }],
    printTypes: [{ type: String, enum: Object.values(ProductPrintType) }],
    sizeGuideTable: [{
      size: { type: String, required: true, trim: true },
      chest: { type: Number, min: 0 },
      length: { type: Number, min: 0 },
      shoulder: { type: Number, min: 0 }
    }],
    seo: {
      title: { type: String, trim: true },
      description: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
productSchema.index({ categoryId: 1 });
productSchema.index({ themeIds: 1 });
productSchema.index({ status: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ isNewArrival: 1 });
productSchema.index({ isBestSeller: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ "variants.sku": 1 });
// Text index for search functionality (Product name, description, tags)
productSchema.index({ name: "text", description: "text", tags: "text" });

export const Product = mongoose.model<IProduct>("Product", productSchema);
