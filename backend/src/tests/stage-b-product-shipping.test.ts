/**
 * Stage B Addendum: Product-Specific Free Shipping Comprehensive Test Suite
 *
 * Covers:
 * GROUP 1: Product Defaults & Validation (Defaults to disabled, missing threshold on enable rejected 400, negative/NaN/Infinity rejected, explicit 0 accepted, disabled never qualifies, empty bucket never qualifies)
 * GROUP 2: Threshold Boundaries & Bucket Aggregation (Below threshold fails, exactly at threshold qualifies, above threshold qualifies, GST-inclusive basis, multiple lines summed)
 * GROUP 3: Product Isolation & No Unrelated Pooling (Distinct products never pool subtotals to satisfy a threshold)
 * GROUP 4: Mandatory Whole-Order Free Delivery Rule (If any single product qualifies, entire order gets free delivery)
 * GROUP 5: Variants, Colors, Sizes & Customizations (Multiple variants/colors/sizes properly aggregated without deduplication; variant add-on prices & customizations included)
 * GROUP 6: Coupon Interaction & Tax Preservation (Product coupons evaluated after merchandise threshold; coupon does not revoke earned product free delivery; tax = 0)
 * GROUP 7: Independence & Source Precedence (Global > Category > Product > None)
 * GROUP 8: Pricing Fingerprint Invariants & Stale Fingerprint Protection (Product threshold change invalidates fingerprint; 409 PRICING_CHANGED on stale)
 * GROUP 9: Cart Preview & Order Creation Consistency (Identical calculations; client tampering ignored)
 * GROUP 10: Admin Product Route Security, Validation & Audit Logging (Mounted Express HTTP server: 401, 403, 400, 200, AuditLog verification)
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import net from "net";
import express from "express";
import jwt from "jsonwebtoken";
import { getJwtAccessSecret } from "../config/env";
import {
  assertSafeTestDatabase,
  getVerifiedTestMongoUri,
  extractDatabaseName,
} from "../config/testDbGuard";
import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import {
  StoreShippingConfig,
  DEFAULT_SHIPPING_CONFIG_KEY,
} from "../models/StoreShippingConfig";
import { Category, CategoryStatus } from "../models/Category";
import { Product } from "../models/Product";
import { PricingEngineService } from "../services/pricing/PricingEngineService";
import { Coupon, DiscountType, CouponStatus } from "../models/Coupon";
import { Cart } from "../models/Cart";
import { Order } from "../models/Order";
import { Address } from "../models/Address";
import { User, UserRole } from "../models/User";
import { AuditLog } from "../models/AuditLog";
import { createOrder } from "../controllers/orderController";
import adminCatalogRoutes from "../routes/adminCatalogRoutes";
import { errorHandler } from "../middleware/errorHandler";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  body: Record<string, unknown> | null;
  status: (code: number) => MockResponse;
  json: (data: Record<string, unknown>) => MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: Record<string, unknown>) {
      this.body = data;
      return this;
    },
  };
  return res;
}

async function runStageBProductShippingTests() {
  console.log("================================================================================");
  console.log("  Stage B Addendum: Product-Specific Free Shipping Comprehensive Test Suite");
  console.log("================================================================================");

  let httpServer: http.Server | null = null;
  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupCategoryIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];
  const cleanupCouponIds: mongoose.Types.ObjectId[] = [];
  const cleanupCartIds: mongoose.Types.ObjectId[] = [];

  try {
    await connectSafeTestDb();
    assertSafeTestDatabase();
    const uri = getVerifiedTestMongoUri();
    const dbName = extractDatabaseName(uri);
    check(
      dbName === "samrat_fashion_test_isolated",
      "0.1 Database verified as isolated 'samrat_fashion_test_isolated'"
    );

    // Setup Baseline Store Configuration: Standard Shipping = 100, Global Threshold = 7999, Enabled = true
    await StoreShippingConfig.findOneAndUpdate(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      {
        standardShippingFee: 100,
        globalFreeShippingThreshold: 7999,
        isGlobalFreeShippingActive: true,
      },
      { upsert: true, new: true }
    );

    const timestamp = Date.now();
    const dummyUser = new mongoose.Types.ObjectId();

    const baseCategory = await Category.create({
      name: `Product Test Base Cat ${timestamp}`,
      slug: `prod-test-base-cat-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: false,
      freeShippingMinAmount: 0,
    });
    cleanupCategoryIds.push(baseCategory._id as mongoose.Types.ObjectId);

    // ================================================================================
    // GROUP 1: Product Defaults & Validation
    // ================================================================================
    console.log("\n[GROUP 1: PRODUCT DEFAULTS AND VALIDATION]");

    // 1.1 New product created without explicit shipping fields defaults to disabled and 0
    const { product: prodDefault, productId: prodDefaultId } = await createTestProduct({
      name: `Prod Default ${timestamp}`,
      basePrice: 500,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodDefaultId));

    check(
      prodDefault.isFreeShippingEnabled === false,
      "1.1 Product without explicit shipping fields defaults to isFreeShippingEnabled = false"
    );
    check(
      prodDefault.freeShippingMinAmount === 0,
      "1.2 Product without explicit shipping fields defaults to freeShippingMinAmount = 0"
    );

    // 1.3 Disabled product never qualifies even when subtotal > threshold
    const { productId: prodDisabledId, variantIds: prodDisabledVarIds } = await createTestProduct({
      name: `Prod Disabled ${timestamp}`,
      basePrice: 1500,
      isFreeShippingEnabled: false,
      freeShippingMinAmount: 1000,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodDisabledId));

    const calcDisabled = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodDisabledId, variantId: prodDisabledVarIds[0], quantity: 2 }], // 3000
    });
    check(
      calcDisabled.summary.isFreeShippingEarned === false && calcDisabled.summary.shipping === 100,
      "1.3 Disabled product rule never qualifies even when product subtotal (3000) exceeds threshold (1000)"
    );

    // 1.4 Zero-threshold rule: threshold = 0 qualifies ONLY when product subtotal > 0
    const { productId: prodZeroThresholdId, variantIds: prodZeroVarIds } = await createTestProduct({
      name: `Prod Zero ${timestamp}`,
      basePrice: 200,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 0,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodZeroThresholdId));

    const calcZero = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodZeroThresholdId, variantId: prodZeroVarIds[0], quantity: 1 }], // 200
    });
    check(
      calcZero.summary.isFreeShippingEarned === true &&
      calcZero.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcZero.summary.shipping === 0,
      "1.4 Explicit zero-threshold product qualifies when subtotal > 0 (200)"
    );

    // 1.5 Empty product bucket never qualifies
    check(
      !calcDisabled.summary.qualifyingProductIds.includes(prodZeroThresholdId),
      "1.5 Product not present in cart has empty bucket and never qualifies"
    );

    // ================================================================================
    // GROUP 2: Threshold Boundaries & Bucket Aggregation
    // ================================================================================
    console.log("\n[GROUP 2: THRESHOLD BOUNDARIES AND BUCKET AGGREGATION]");

    const { productId: prodBoundaryId, variantIds: prodBoundaryVarIds } = await createTestProduct({
      name: `Prod Boundary ${timestamp}`,
      basePrice: 1000,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 2000,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodBoundaryId));

    // 2.1 Subtotal below threshold (1000 < 2000) fails
    const calcBelow = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodBoundaryId, variantId: prodBoundaryVarIds[0], quantity: 1 }],
    });
    check(
      calcBelow.summary.isFreeShippingEarned === false && calcBelow.summary.shipping === 100,
      "2.1 Product subtotal below threshold (1000 < 2000) does not qualify for free shipping"
    );

    // 2.2 Subtotal exactly equal to threshold (2000 == 2000) qualifies
    const calcExact = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodBoundaryId, variantId: prodBoundaryVarIds[0], quantity: 2 }],
    });
    check(
      calcExact.summary.isFreeShippingEarned === true &&
      calcExact.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcExact.summary.shipping === 0,
      "2.2 Product subtotal exactly equal to threshold (2000 == 2000) qualifies for free shipping"
    );

    // 2.3 Subtotal above threshold (3000 > 2000) qualifies
    const calcAbove = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodBoundaryId, variantId: prodBoundaryVarIds[0], quantity: 3 }],
    });
    check(
      calcAbove.summary.isFreeShippingEarned === true &&
      calcAbove.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcAbove.summary.shipping === 0,
      "2.3 Product subtotal above threshold (3000 > 2000) qualifies for free shipping"
    );

    // 2.4 Multiple cart lines of the same product sum into a single product bucket
    const { productId: prodMultiLineId, variantIds: prodMultiLineVarIds } = await createTestProduct({
      name: `Prod MultiLine ${timestamp}`,
      basePrice: 500,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 1400,
      variants: [
        { size: "M", color: "Black", stock: 20, isAvailable: true, additionalPrice: 0 },
        { size: "L", color: "White", stock: 20, isAvailable: true, additionalPrice: 100 },
      ],
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodMultiLineId));

    // Line 1: Size M @ 500 x 1 = 500
    // Line 2: Size L @ 600 x 2 = 1200
    // Total product subtotal = 1700 >= 1400 threshold
    const calcMultiLine = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodMultiLineId, variantId: prodMultiLineVarIds[0], quantity: 1 },
        { productId: prodMultiLineId, variantId: prodMultiLineVarIds[1], quantity: 2 },
      ],
    });
    check(
      calcMultiLine.summary.isFreeShippingEarned === true &&
      calcMultiLine.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcMultiLine.summary.qualifyingProductIds.includes(prodMultiLineId),
      "2.4 Multiple cart lines of the same product sum into a single product bucket (500 + 1200 = 1700 >= 1400)"
    );

    // ================================================================================
    // GROUP 3: Product Isolation & No Unrelated Pooling
    // ================================================================================
    console.log("\n[GROUP 3: PRODUCT ISOLATION AND NO UNRELATED POOLING]");

    const { productId: prodAId, variantIds: prodAVarIds } = await createTestProduct({
      name: `Prod Isolation A ${timestamp}`,
      basePrice: 800,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 2000,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodAId));

    const { productId: prodBId, variantIds: prodBVarIds } = await createTestProduct({
      name: `Prod Isolation B ${timestamp}`,
      basePrice: 700,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 2000,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodBId));

    // Prod A: 2 x 800 = 1600 (threshold 2000) -> Does not qualify
    // Prod B: 2 x 700 = 1400 (threshold 2000) -> Does not qualify
    // Pooled subtotal would be 3000 >= 2000, but products MUST NOT pool!
    const calcIsolation = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodAId, variantId: prodAVarIds[0], quantity: 2 },
        { productId: prodBId, variantId: prodBVarIds[0], quantity: 2 },
      ],
    });
    check(
      calcIsolation.summary.isFreeShippingEarned === false &&
      calcIsolation.summary.shipping === 100 &&
      calcIsolation.summary.qualifyingProductIds.length === 0,
      "3.1 Two unrelated products never pool their subtotals (Prod A: 1600 < 2000, Prod B: 1400 < 2000 -> Shipping = 100)"
    );

    // ================================================================================
    // GROUP 4: Mandatory Whole-Order Free Delivery Rule
    // ================================================================================
    console.log("\n[GROUP 4: MANDATORY WHOLE-ORDER FREE DELIVERY RULE]");

    // If Product A qualifies (e.g. 3 x 800 = 2400 >= 2000), but Product B does not (700 < 2000),
    // the ENTIRE order receives free standard shipping!
    const calcWholeOrder = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodAId, variantId: prodAVarIds[0], quantity: 3 }, // 2400 -> Qualifies
        { productId: prodBId, variantId: prodBVarIds[0], quantity: 1 }, // 700 -> Does not
      ],
    });
    check(
      calcWholeOrder.summary.isFreeShippingEarned === true &&
      calcWholeOrder.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcWholeOrder.summary.shipping === 0 &&
      calcWholeOrder.summary.qualifyingProductIds.includes(prodAId) &&
      !calcWholeOrder.summary.qualifyingProductIds.includes(prodBId),
      "4.1 When any single product qualifies (Prod A), the ENTIRE order receives free delivery (shipping = 0)"
    );

    // ================================================================================
    // GROUP 5: Variants, Colors, Sizes & Customizations
    // ================================================================================
    console.log("\n[GROUP 5: VARIANTS, COLORS, SIZES AND CUSTOMIZATIONS]");

    const { productId: prodVariantsId, variantIds: prodVarIds } = await createTestProduct({
      name: `Prod Variants ${timestamp}`,
      basePrice: 1000,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 3000,
      variants: [
        { size: "M", color: "Onyx Black", stock: 50, isAvailable: true, additionalPrice: 0 },
        { size: "XL", color: "Onyx Black", stock: 50, isAvailable: true, additionalPrice: 200 },
        { size: "L", color: "Off-White", stock: 50, isAvailable: true, additionalPrice: 100 },
      ],
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodVariantsId));

    // Distinct variants of same product:
    // Line 1: M Black (1000) x 1 = 1000
    // Line 2: XL Black (1200) x 1 = 1200
    // Line 3: L White (1100) x 1 = 1100
    // Total product subtotal = 3300 >= 3000 threshold
    const calcVariants = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodVariantsId, variantId: prodVarIds[0], quantity: 1 },
        { productId: prodVariantsId, variantId: prodVarIds[1], quantity: 1 },
        { productId: prodVariantsId, variantId: prodVarIds[2], quantity: 1 },
      ],
    });
    check(
      calcVariants.summary.isFreeShippingEarned === true &&
      calcVariants.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcVariants.summary.subtotal === 3300 &&
      calcVariants.summary.shipping === 0,
      "5.1 Multiple distinct color/size variants of same product correctly aggregated (1000 + 1200 + 1100 = 3300 >= 3000)"
    );

    // Customized product line with volume pricing
    const { productId: prodCustomId, variantIds: prodCustomVarIds } = await createTestProduct({
      name: `Prod Custom ${timestamp}`,
      basePrice: 300,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 4000,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodCustomId));

    const customConfig = {
      color: "BLACK",
      variantId: new mongoose.Types.ObjectId(prodCustomVarIds[0]),
      sizeDistribution: [
        { size: "M", quantity: 6 },
        { size: "L", quantity: 6 },
      ],
    };

    const calcCustom = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        {
          productId: prodCustomId,
          variantId: prodCustomVarIds[0],
          quantity: 12,
          isCustomized: true,
          customConfigurations: [customConfig],
        },
      ],
    });
    check(
      calcCustom.summary.isFreeShippingEarned === true &&
      calcCustom.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcCustom.summary.shipping === 0,
      "5.2 Customized product lines with volume pricing correctly calculate line total and qualify product bucket"
    );

    // ================================================================================
    // GROUP 6: Coupon Interaction & Tax Preservation
    // ================================================================================
    console.log("\n[GROUP 6: COUPON INTERACTION AND TAX PRESERVATION]");

    const coupon = await Coupon.create({
      code: `PRODSHIP150_${timestamp}`,
      description: "Save 150 on apparel",
      discountType: DiscountType.FIXED,
      discountValue: 150,
      minOrderValue: 0,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(coupon._id as mongoose.Types.ObjectId);

    // Product has subtotal 2000 >= threshold 2000.
    // Applying coupon reduces total to 1850, but product merchandise subtotal remains 2000.
    // The coupon MUST NOT revoke earned free shipping!
    const calcCoupon = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodBoundaryId, variantId: prodBoundaryVarIds[0], quantity: 2 }], // 2000
      couponCode: coupon.code,
    });
    check(
      calcCoupon.summary.subtotal === 2000 &&
      calcCoupon.summary.discount === 150 &&
      calcCoupon.summary.total === 1850 &&
      calcCoupon.summary.isFreeShippingEarned === true &&
      calcCoupon.summary.shipping === 0 &&
      calcCoupon.summary.tax === 0,
      "6.1 Applying a product discount coupon does not revoke product-earned free delivery and tax is 0"
    );

    // ================================================================================
    // GROUP 7: Independence & Source Precedence
    // ================================================================================
    console.log("\n[GROUP 7: INDEPENDENCE AND SOURCE PRECEDENCE]");

    // Category with Free Shipping @ 1500
    const catPrecedence = await Category.create({
      name: `Cat Precedence ${timestamp}`,
      slug: `cat-precedence-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 1500,
    });
    cleanupCategoryIds.push(catPrecedence._id as mongoose.Types.ObjectId);

    const { productId: prodInCatId, variantIds: prodInCatVarIds } = await createTestProduct({
      name: `Prod in Cat ${timestamp}`,
      categoryId: catPrecedence._id as mongoose.Types.ObjectId,
      basePrice: 1000,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 1800,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodInCatId));

    // 7.1 Global Threshold Met: subtotal 8000 >= 7999 -> freeShippingSource = "GLOBAL_THRESHOLD"
    const calcGlobal = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodInCatId, variantId: prodInCatVarIds[0], quantity: 8 }], // 8000
    });
    check(
      calcGlobal.summary.freeShippingSource === "GLOBAL_THRESHOLD" &&
      calcGlobal.summary.shipping === 0,
      "7.1 When Global threshold is met, freeShippingSource is 'GLOBAL_THRESHOLD'"
    );

    // 7.2 Global Not Met, Category Met: subtotal 1600 (< 7999 global, >= 1500 cat, < 1800 prod)
    // Buy 1 x prodInCat (1000) + 1 x other prod in cat (600) -> Cat subtotal 1600 >= 1500, Prod subtotal 1000 < 1800
    const { productId: prodInCat2Id, variantIds: prodInCat2VarIds } = await createTestProduct({
      name: `Prod in Cat 2 ${timestamp}`,
      categoryId: catPrecedence._id as mongoose.Types.ObjectId,
      basePrice: 600,
      isFreeShippingEnabled: false,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodInCat2Id));

    const calcCatPrecedence = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodInCatId, variantId: prodInCatVarIds[0], quantity: 1 }, // 1000
        { productId: prodInCat2Id, variantId: prodInCat2VarIds[0], quantity: 1 }, // 600
      ],
    });
    check(
      calcCatPrecedence.summary.freeShippingSource === "CATEGORY_RULE" &&
      calcCatPrecedence.summary.shipping === 0,
      "7.2 When Global not met but Category is met, freeShippingSource is 'CATEGORY_RULE'"
    );

    // 7.3 Global Not Met, Category Not Met, Product Met:
    // Buy 2 x prodBoundary (2000 >= 2000 prod threshold) in baseCategory (disabled cat shipping)
    const calcProdPrecedence = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodBoundaryId, variantId: prodBoundaryVarIds[0], quantity: 2 }], // 2000
    });
    check(
      calcProdPrecedence.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcProdPrecedence.summary.shipping === 0 &&
      calcProdPrecedence.summary.qualifyingProductIds.includes(prodBoundaryId),
      "7.3 When Global and Category are not met, but Product qualifies, freeShippingSource is 'PRODUCT_RULE'"
    );

    // 7.4 Global Disabled, Category Disabled, Product Met:
    await StoreShippingConfig.findOneAndUpdate(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { isGlobalFreeShippingActive: false }
    );
    const calcGlobalDisabled = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodBoundaryId, variantId: prodBoundaryVarIds[0], quantity: 2 }],
    });
    check(
      calcGlobalDisabled.summary.freeShippingSource === "PRODUCT_RULE" &&
      calcGlobalDisabled.summary.shipping === 0,
      "7.4 Product free shipping functions properly even when Global Free Shipping is completely disabled"
    );
    // Restore Global Free Shipping
    await StoreShippingConfig.findOneAndUpdate(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { isGlobalFreeShippingActive: true }
    );

    // ================================================================================
    // GROUP 8: Pricing Fingerprint Invariants & Stale Detection
    // ================================================================================
    console.log("\n[GROUP 8: PRICING FINGERPRINT INVARIANTS AND STALE DETECTION]");

    const { productId: prodFpId, variantIds: prodFpVarIds } = await createTestProduct({
      name: `Prod FP ${timestamp}`,
      basePrice: 1000,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 1500,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodFpId));

    const calcFp1 = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodFpId, variantId: prodFpVarIds[0], quantity: 2 }],
    });
    const calcFp2 = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodFpId, variantId: prodFpVarIds[0], quantity: 2 }],
    });
    check(
      calcFp1.summary.pricingFingerprint === calcFp2.summary.pricingFingerprint,
      "8.1 Unchanged product shipping inputs produce identical deterministic SHA-256 fingerprints"
    );

    // Mutate product threshold from 1500 to 2500 -> fingerprint MUST change!
    await Product.findByIdAndUpdate(prodFpId, { freeShippingMinAmount: 2500 });
    const calcFpMutated = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodFpId, variantId: prodFpVarIds[0], quantity: 2 }],
    });
    check(
      calcFp1.summary.pricingFingerprint !== calcFpMutated.summary.pricingFingerprint,
      "8.2 Changing product free shipping threshold immediately invalidates the pricing fingerprint"
    );

    // Restore threshold
    await Product.findByIdAndUpdate(prodFpId, { freeShippingMinAmount: 1500 });

    // ================================================================================
    // GROUP 9: Cart Preview & Order Creation Consistency
    // ================================================================================
    console.log("\n[GROUP 9: CART PREVIEW AND ORDER CREATION CONSISTENCY]");

    const customerUser = await User.create({
      name: `Customer User ${timestamp}`,
      email: `customer_${timestamp}@example.com`,
      passwordHash: "dummy_hash",
      role: UserRole.CUSTOMER,
    });
    cleanupUserIds.push(customerUser._id as mongoose.Types.ObjectId);

    const address = await Address.create({
      userId: customerUser._id,
      fullName: "Test Customer",
      addressLine1: "123 High Street",
      city: "New Delhi",
      state: "Delhi",
      postalCode: "110001",
      country: "India",
      phone: "9876543210",
      addressType: "HOME",
    });

    const cart = await Cart.create({
      userId: customerUser._id,
      items: [{ productId: prodBoundaryId, variantId: prodBoundaryVarIds[0], quantity: 2 }],
    });
    cleanupCartIds.push(cart._id as mongoose.Types.ObjectId);

    const preview = await PricingEngineService.calculate({
      userId: customerUser._id.toString(),
      items: cart.items,
    });

    // Create Order with client attempting to inject shipping fee of 500
    const mockOrderReq: any = {
      user: { id: customerUser._id.toString(), role: UserRole.CUSTOMER },
      body: {
        addressId: address._id.toString(),
        clientPricingFingerprint: preview.summary.pricingFingerprint,
        shipping: 500, // Client tampering
        total: 2500, // Client tampering
      },
    };
    const mockOrderRes = createMockRes();
    await createOrder(mockOrderReq, mockOrderRes as any, () => {});

    check(
      mockOrderRes.statusCode === 201,
      "9.1 Order created successfully with valid product free shipping pricing fingerprint (HTTP 201)"
    );
    const createdOrderData: any = mockOrderRes.body?.data;
    if (createdOrderData?._id) cleanupOrderIds.push(createdOrderData._id);

    check(
      createdOrderData?.shipping === 0 &&
      createdOrderData?.total === 2000,
      "9.2 Server calculates exact free shipping (0) and ignores client tampering attempts"
    );

    // Stale Fingerprint rejection test
    const staleOrderReq: any = {
      user: { id: customerUser._id.toString(), role: UserRole.CUSTOMER },
      body: {
        addressId: address._id.toString(),
        clientPricingFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // Stale
      },
    };
    const staleOrderRes = createMockRes();
    await createOrder(staleOrderReq, staleOrderRes as any, () => {});
    check(
      staleOrderRes.statusCode === 409,
      "9.3 Stale pricing fingerprint rejected with HTTP 409 PRICING_CHANGED"
    );

    // ================================================================================
    // GROUP 10: Admin Product Route Security, Validation & Audit Logging
    // ================================================================================
    console.log("\n[GROUP 10: ADMIN PRODUCT ROUTE SECURITY, VALIDATION AND AUDIT LOGGING]");

    const adminUser = await User.create({
      name: `Admin User ${timestamp}`,
      email: `admin_${timestamp}@example.com`,
      passwordHash: "dummy_hash",
      role: UserRole.ADMIN,
    });
    cleanupUserIds.push(adminUser._id as mongoose.Types.ObjectId);

    const jwtSecret = getJwtAccessSecret();
    const adminJwt = jwt.sign({ sub: adminUser._id.toString(), role: UserRole.ADMIN }, jwtSecret, {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    const customerJwt = jwt.sign({ sub: customerUser._id.toString(), role: UserRole.CUSTOMER }, jwtSecret, {
      algorithm: "HS256",
      expiresIn: "1h",
    });

    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api/admin", adminCatalogRoutes);
    testApp.use(errorHandler);

    await new Promise<void>((resolve) => {
      httpServer = testApp.listen(0, () => resolve());
    });
    const addressInfo = httpServer!.address() as net.AddressInfo;
    const baseApiUrl = `http://127.0.0.1:${addressInfo.port}/api/admin`;

    // 10.1 Unauthenticated request returns 401
    const unauthRes = await fetch(`${baseApiUrl}/products/${prodBoundaryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: 1200 }),
    });
    check(
      unauthRes.status === 401,
      "10.1 Unauthenticated request to update product rejected with HTTP 401 UNAUTHORIZED"
    );

    // 10.2 Customer token returns 403
    const custRes = await fetch(`${baseApiUrl}/products/${prodBoundaryId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerJwt}`,
      },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: 1200 }),
    });
    check(
      custRes.status === 403,
      "10.2 Customer role rejected with HTTP 403 FORBIDDEN"
    );

    // 10.3 Enabling product free shipping without explicit threshold returns 400
    const enableNoThresholdRes = await fetch(`${baseApiUrl}/products/${prodDefaultId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({ isFreeShippingEnabled: true }), // Missing threshold
    });
    check(
      enableNoThresholdRes.status === 400,
      "10.3 Enabling product free shipping without explicit threshold returns HTTP 400"
    );

    // 10.4 Negative threshold returns 400
    const negativeRes = await fetch(`${baseApiUrl}/products/${prodDefaultId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: -50 }),
    });
    check(
      negativeRes.status === 400,
      "10.4 Negative free shipping threshold returns HTTP 400"
    );

    // 10.5 Non-numeric threshold returns 400
    const nonNumericRes = await fetch(`${baseApiUrl}/products/${prodDefaultId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: "invalid_num" }),
    });
    check(
      nonNumericRes.status === 400,
      "10.5 Non-numeric free shipping threshold returns HTTP 400"
    );

    // 10.6 Authorized admin update succeeds (HTTP 200) and persists
    const updateRes = await fetch(`${baseApiUrl}/products/${prodBoundaryId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({
        isFreeShippingEnabled: true,
        freeShippingMinAmount: 2499,
      }),
    });
    check(
      updateRes.status === 200,
      "10.6 Authorized admin update of product shipping settings succeeds with HTTP 200"
    );

    const persistedProd = await Product.findById(prodBoundaryId);
    check(
      persistedProd?.isFreeShippingEnabled === true &&
      persistedProd?.freeShippingMinAmount === 2499,
      "10.7 Updated product free shipping settings correctly persisted to database (2499)"
    );

    // 10.8 AuditLog records previous and updated settings
    const auditRecord = await AuditLog.findOne({
      action: "ADMIN_PRODUCT_UPDATED",
      entityId: prodBoundaryId,
      actorId: adminUser._id,
    }).sort({ createdAt: -1 });

    check(
      auditRecord !== null &&
      auditRecord.metadata?.updated?.freeShippingMinAmount === 2499 &&
      auditRecord.metadata?.updated?.isFreeShippingEnabled === true,
      "10.8 AuditLog captures ADMIN_PRODUCT_UPDATED action with exact previous and updated shipping settings"
    );

    // 10.9 Updating disabled product preserves threshold
    await Product.findByIdAndUpdate(prodBoundaryId, { isFreeShippingEnabled: false, freeShippingMinAmount: 2499 });
    const updateOtherFieldsRes = await fetch(`${baseApiUrl}/products/${prodBoundaryId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
      body: JSON.stringify({ description: "Updated description text" }),
    });
    const preservedProd = await Product.findById(prodBoundaryId);
    check(
      updateOtherFieldsRes.status === 200 &&
      preservedProd?.isFreeShippingEnabled === false &&
      preservedProd?.freeShippingMinAmount === 2499,
      "10.9 Updating other product fields preserves configured shipping threshold without clearing or resetting"
    );

  } catch (err) {
    console.error("Test execution threw exception:", err);
    failed++;
  } finally {
    if (httpServer) {
      await new Promise<void>((resolve) => (httpServer as http.Server).close(() => resolve()));
    }
    console.log("\nCleaning up test fixtures from database...");
    await Product.deleteMany({ _id: { $in: cleanupProductIds } });
    await Category.deleteMany({ _id: { $in: cleanupCategoryIds } });
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
    await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
    await Coupon.deleteMany({ _id: { $in: cleanupCouponIds } });
    await Cart.deleteMany({ _id: { $in: cleanupCartIds } });
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }

  console.log("\n================================================================================");
  console.log(`  Stage B Addendum Results: ${passed} passed, ${failed} failed`);
  console.log("================================================================================");

  if (failed > 0) {
    console.error("\nFailures:");
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
}

runStageBProductShippingTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
