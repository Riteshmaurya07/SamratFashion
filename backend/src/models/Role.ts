import mongoose, { Document, Schema } from "mongoose";

export const ADMIN_MODULES = [
  // Overview
  "dashboard",
  // Store Management
  "orders",
  "products",
  "categories",
  "inventory",
  "customers",
  "returns",
  "reviews",
  "support",
  "settings",
  // Custom Printing & Production
  "printCatalog",
  "printPricing",
  "customOrders",
  "bulkOrders",
  "production",
  // Marketing & CMS
  "banners",
  "campaigns",
  "coupons",
  "themes",
  // Operations & Reporting
  "invoices",
  "inventoryLedger",
  "notifications",
  "paymentReconciliation",
  "paymentDiagnostics",
  "auditLogs",
  "webhooks",
  "systemHealth",
] as const;

export type AdminModule = (typeof ADMIN_MODULES)[number];
export type PermissionLevel = "none" | "view" | "manage";

export interface IRolePermissions {
  [key: string]: PermissionLevel;
}

export interface IRoleSensitiveActions {
  canRefund: boolean;
  canChangePrices: boolean;
  canManageCoupons: boolean;
  canSuspendUsers: boolean;
  canManageSettings: boolean;
  canManageWebhooks: boolean;
}

export interface IRole extends Document {
  name: string;
  description: string;
  permissions: Record<AdminModule, PermissionLevel>;
  canRefund: boolean;
  canChangePrices: boolean;
  canManageCoupons: boolean;
  canSuspendUsers: boolean;
  canManageSettings: boolean;
  canManageWebhooks: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    permissions: {
      type: Schema.Types.Mixed,
      default: () => {
        const defaultPerms = {} as Record<AdminModule, PermissionLevel>;
        for (const mod of ADMIN_MODULES) {
          defaultPerms[mod] = "none";
        }
        return defaultPerms;
      },
    },
    canRefund: {
      type: Boolean,
      default: false,
    },
    canChangePrices: {
      type: Boolean,
      default: false,
    },
    canManageCoupons: {
      type: Boolean,
      default: false,
    },
    canSuspendUsers: {
      type: Boolean,
      default: false,
    },
    canManageSettings: {
      type: Boolean,
      default: false,
    },
    canManageWebhooks: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

roleSchema.index({ createdBy: 1 });

export const Role = mongoose.model<IRole>("Role", roleSchema);
