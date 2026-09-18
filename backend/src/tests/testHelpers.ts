/**
 * Shared test utilities for Phase 6 test suites.
 * Provides a standardized product factory that satisfies all required Product schema fields.
 */

import mongoose from "mongoose";
import { Product, ProductStatus } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";
import { IDesignElement, IDesignLayout } from "../models/CustomTemplate";

// A valid stub categoryId for use in tests (no real category required)
export const TEST_CATEGORY_ID = new mongoose.Types.ObjectId();

export interface TestVariant {
  size: string;
  color: string;
  additionalPrice?: number;
  stock?: number;
  isAvailable?: boolean;
}

/**
 * Creates a valid Product document for test use.
 * Fills all required fields so the schema doesn't throw.
 */
export async function createTestProduct(overrides: {
  name?: string;
  variants?: TestVariant[];
  basePrice?: number;
  printMethods?: string[];
} = {}): Promise<{ product: any; productId: string; variantIds: string[] }> {
  const variants = (overrides.variants || [
    { size: "M", color: "BLACK", additionalPrice: 0, stock: 50, isAvailable: true },
  ]).map(v => ({
    ...v,
    sku: `TST-${v.color}-${v.size}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    additionalPrice: v.additionalPrice ?? 0,
    stock: v.stock ?? 50,
    isAvailable: v.isAvailable ?? true,
  }));

  const product = await Product.create({
    name: overrides.name || `Test Tee ${Date.now()}`,
    slug: `test-tee-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    description: "Test product for Phase 6 automated test suite",
    categoryId: TEST_CATEGORY_ID,
    basePrice: overrides.basePrice ?? 500,
    mrp: (overrides.basePrice ?? 500) * 1.2,
    status: ProductStatus.ACTIVE,
    variants,
    images: ["https://example.com/test-tee.jpg"],
    ...(overrides.printMethods ? { printMethods: overrides.printMethods } : {}),
    printableZones: {
      front: [{ id: "front-zone-1", x: 50, y: 100, width: 300, height: 350 }],
      back: [{ id: "back-zone-1", x: 100, y: 100, width: 250, height: 400 }],
      leftSleeve: [],
      rightSleeve: [],
    },
  });

  return {
    product,
    productId: product._id.toString(),
    variantIds: product.variants.map((v: any) => v._id.toString()),
  };
}

/**
 * Creates a valid CustomDesign document for test use.
 */
export async function createTestDesign(params: {
  userId: string;
  productId: mongoose.Types.ObjectId | string;
  variantId: mongoose.Types.ObjectId | string;
  color?: string;
  name?: string;
  numElements?: number;
}): Promise<{ design: any; designId: string }> {
  const elements: IDesignElement[] = Array.from({ length: params.numElements ?? 1 }, (_, i) => ({
    id: `el-${i}`,
    type: "TEXT" as const,
    x: 100 + i * 20,
    y: 150 + i * 20,
    width: 200,
    height: 50,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    locked: false,
    zIndex: i,
    properties: { text: `Test Element ${i}`, fontSize: 24, fontFamily: "Arial", color: "#000000" },
  }));

  const layout: IDesignLayout = {
    front: { elements },
    back: { elements: [] },
    leftSleeve: { elements: [] },
    rightSleeve: { elements: [] },
  };

  const design = await CustomDesign.create({
    userId: new mongoose.Types.ObjectId(params.userId),
    name: params.name || `Test Design ${Date.now()}`,
    productId: new mongoose.Types.ObjectId(params.productId.toString()),
    selectedVariantId: new mongoose.Types.ObjectId(params.variantId.toString()),
    selectedColor: params.color || "BLACK",
    status: "DRAFT",
    requestType: "DESIGN",
    printLocations: ["FRONT"],
    currentVersion: 1,
    submissionKey: `test-design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    design: layout,
    versions: [{
      version: 1,
      design: layout,
      createdBy: new mongoose.Types.ObjectId(params.userId),
      createdAt: new Date(),
      status: "DRAFT",
      previewUrls: [],
      artworkUrls: [],
    }],
  });

  return { design, designId: design._id.toString() };
}
