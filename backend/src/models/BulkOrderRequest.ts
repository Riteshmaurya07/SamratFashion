import mongoose, { Document, Schema } from "mongoose";

export enum BulkRequestStatus {
  REQUESTED = "REQUESTED",
  UNDER_REVIEW = "UNDER_REVIEW",
  CONTACTED = "CONTACTED",
  MOCKUP_SHARED = "MOCKUP_SHARED",
  REVISION_REQUESTED = "REVISION_REQUESTED",
  DESIGN_APPROVED = "DESIGN_APPROVED",
  CONFIRMED = "CONFIRMED",
  QUOTED = "QUOTED",
  ACCEPTED = "ACCEPTED",
  ORDER_CREATED = "ORDER_CREATED",
  REJECTED = "REJECTED",
  CLOSED = "CLOSED",
  CANCELLED = "CANCELLED",
}

export interface IVariantBreakdown {
  S?: number;
  M?: number;
  L?: number;
  XL?: number;
  XXL?: number;
  [size: string]: number | undefined;
}

export interface IVariantAllocation {
  variantId?: mongoose.Types.ObjectId;
  size: string;
  color?: string;
  quantity: number;
  sku?: string;
}

export interface IArtworkFile {
  url: string;
  publicId?: string;
  originalFilename?: string;
  fileType?: string;
  sizeBytes?: number;
}

export interface IMockupHistory {
  version: number;
  mockupUrl: string;
  notes?: string;
  uploadedBy?: mongoose.Types.ObjectId;
  uploadedAt: Date;
}

export interface IApprovalDecision {
  decision: "APPROVED" | "REVISION_REQUESTED";
  comment?: string;
  decidedAt: Date;
  decidedBy?: mongoose.Types.ObjectId;
  mockupVersion?: number;
}

export interface IBulkOrderRequest extends Document {
  quoteNumber: string;
  userId?: mongoose.Types.ObjectId;
  organizationName?: string;
  contactName: string;
  email: string;
  phone: string;
  productId: mongoose.Types.ObjectId;
  catalogItemId?: mongoose.Types.ObjectId;
  variantBreakdown: IVariantBreakdown;
  variantAllocations?: IVariantAllocation[];
  totalQuantity: number;
  colorAllocation?: string;
  customPrintingRequired: boolean;
  customDesignId?: mongoose.Types.ObjectId;
  printLocations: string[];
  printMethod?: string;
  artworkFiles?: IArtworkFile[];
  needsDesignAssistance?: boolean;
  printText?: string;
  preferredColors?: string[];
  designPreferences?: string;
  mockupHistory?: IMockupHistory[];
  currentMockupUrl?: string;
  approvalDecision?: IApprovalDecision;
  approvalHistory?: IApprovalDecision[];
  deliveryLocation: string;
  city?: string;
  state?: string;
  postalCode?: string;
  requiredByDate?: Date;
  customerNote?: string;
  status: BulkRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

const variantAllocationSchema = new Schema<IVariantAllocation>(
  {
    variantId: { type: Schema.Types.ObjectId, ref: "Product.variants" },
    size: { type: String, required: true, trim: true },
    color: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    sku: { type: String, trim: true },
  },
  { _id: false }
);

const artworkFileSchema = new Schema<IArtworkFile>(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, trim: true },
    originalFilename: { type: String, trim: true },
    fileType: { type: String, trim: true },
    sizeBytes: { type: Number, min: 0 },
  },
  { _id: false }
);

const mockupHistorySchema = new Schema<IMockupHistory>(
  {
    version: { type: Number, required: true },
    mockupUrl: { type: String, required: true, trim: true },
    notes: { type: String, trim: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const approvalDecisionSchema = new Schema<IApprovalDecision>(
  {
    decision: { type: String, enum: ["APPROVED", "REVISION_REQUESTED"], required: true },
    comment: { type: String, trim: true },
    decidedAt: { type: Date, default: Date.now },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    mockupVersion: { type: Number },
  },
  { _id: false }
);

const variantBreakdownSchema = new Schema<IVariantBreakdown>(
  {
    S: { type: Number, default: 0 },
    M: { type: Number, default: 0 },
    L: { type: Number, default: 0 },
    XL: { type: Number, default: 0 },
    XXL: { type: Number, default: 0 },
  },
  { _id: false, strict: false }
);

const bulkOrderRequestSchema = new Schema<IBulkOrderRequest>(
  {
    quoteNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    organizationName: { type: String, trim: true, max: 120, default: "Individual" },
    contactName: { type: String, required: true, trim: true, max: 120 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    catalogItemId: { type: Schema.Types.ObjectId, ref: "CustomPrintCatalogItem" },
    variantBreakdown: { type: variantBreakdownSchema, default: () => ({}) },
    variantAllocations: { type: [variantAllocationSchema], default: [] },
    totalQuantity: { type: Number, required: true, min: 1 },
    colorAllocation: { type: String, trim: true },
    customPrintingRequired: { type: Boolean, default: false },
    customDesignId: { type: Schema.Types.ObjectId, ref: "CustomDesign" },
    printLocations: [{ type: String }],
    printMethod: { type: String, default: "DTF Transfer" },
    artworkFiles: { type: [artworkFileSchema], default: [] },
    needsDesignAssistance: { type: Boolean, default: false },
    printText: { type: String, trim: true, max: 500 },
    preferredColors: [{ type: String, trim: true }],
    designPreferences: { type: String, trim: true, max: 1000 },
    mockupHistory: { type: [mockupHistorySchema], default: [] },
    currentMockupUrl: { type: String, trim: true },
    approvalDecision: { type: approvalDecisionSchema },
    approvalHistory: { type: [approvalDecisionSchema], default: [] },
    deliveryLocation: { type: String, required: true, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    requiredByDate: { type: Date },
    customerNote: { type: String, trim: true, max: 1000 },
    status: {
      type: String,
      enum: Object.values(BulkRequestStatus),
      default: BulkRequestStatus.REQUESTED,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

bulkOrderRequestSchema.index({ userId: 1, createdAt: -1 });
bulkOrderRequestSchema.index({ status: 1, createdAt: -1 });

export const BulkOrderRequest = mongoose.model<IBulkOrderRequest>("BulkOrderRequest", bulkOrderRequestSchema);

