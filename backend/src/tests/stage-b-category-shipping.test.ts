/**
 * Stage B: Category-Specific Free Shipping Comprehensive Test Suite
 *
 * Covers:
 * GROUP A: GST-Inclusive Threshold Behaviour (Selling price basis, coupon non-revocation)
 * GROUP B: Actual Colour & Size Variants (Different colours, sizes, variant add-ons, no deduplication)
 * GROUP C: Customization & Volume Pricing (Custom designs, bulk discount tiers from PricingService)
 * GROUP D: Root & Child Category Edge Cases (Direct, child-only, mixed roll-up, independent qualification)
 * GROUP E: Pricing Fingerprint Invariants (Category mutations invalidate, deterministic hashing, 409)
 * GROUP F: Cart Preview & Order Creation Consistency (Identical totals, client tampering protection)
 * GROUP G: Actual Mounted Route Security & Integration (Ephemeral HTTP server: 401, 403, 200, AuditLog)
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import net from "net";
import express, { Request, Response } from "express";
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
  getStoreShippingConfig,
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

async function runStageBTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Stage B: Category-Specific Free Shipping Comprehensive Suite ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupCategoryIds: mongoose.Types.ObjectId[] = [];
  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupCouponIds: mongoose.Types.ObjectId[] = [];
  let testHttpServer: http.Server | null = null;

  try {
    // ─────────────────────────────────────────────────────────────────────────────
    // 0. DATABASE SAFETY & ISOLATION VERIFICATION
    // ─────────────────────────────────────────────────────────────────────────────
    await connectSafeTestDb();
    assertSafeTestDatabase();
    const activeTestUri = getVerifiedTestMongoUri();
    const activeDbName = extractDatabaseName(activeTestUri);
    console.log(` Connected to verified isolated test database: ${activeDbName}\n`);
    check(activeDbName === "samrat_fashion_test_isolated", "0.1 Database verified as isolated 'samrat_fashion_test_isolated'");

    const timestamp = Date.now();
    const dummyUser = new mongoose.Types.ObjectId();

    // Ensure baseline store shipping configuration (₹999 / ₹100, enabled)
    await StoreShippingConfig.deleteMany({});
    await getStoreShippingConfig();

    // ─────────────────────────────────────────────────────────────────────────────
    // GROUP A: GST-INCLUSIVE THRESHOLD BEHAVIOUR (SELLING PRICE BASIS)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[GROUP A: GST-INCLUSIVE THRESHOLD BEHAVIOUR]");

    const catGst = await Category.create({
      name: `GST Cat ${timestamp}`,
      slug: `gst-cat-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 999,
    });
    cleanupCategoryIds.push(catGst._id as mongoose.Types.ObjectId);

    const { product: prodGst999 } = await createTestProduct({
      name: `GST Product ₹999 ${timestamp}`,
      basePrice: 999,
      categoryId: catGst._id,
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodGst999._id));

    // A.1 Subtotal ₹999 qualifies for global threshold without tax subtraction
    const calcGstGlobal = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodGst999._id, variantId: prodGst999.variants[0]._id, quantity: 1 }],
    });
    check(calcGstGlobal.summary.subtotal === 999, "A.1 GST-inclusive merchandise subtotal is ₹999");
    check(calcGstGlobal.summary.isFreeShippingEarned === true, "A.2 Subtotal ₹999 qualifies for global ₹999 threshold without tax deduction");
    check(calcGstGlobal.summary.shipping === 0, "A.3 Standard shipping is ₹0");

    // A.2 Category threshold qualifies on GST-inclusive merchandise subtotal
    check(calcGstGlobal.summary.qualifyingCategoryIds.includes(catGst._id.toString()), "A.4 Category subtotal exactly equal to threshold (₹999) qualifies");

    // A.3 Coupon discount applied after eligibility does NOT revoke free shipping
    const couponGst = await Coupon.create({
      code: `GSTCOUPON_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 150,
      minOrderValue: 0,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(couponGst._id);

    const calcGstWithCoupon = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodGst999._id, variantId: prodGst999.variants[0]._id, quantity: 1 }],
      couponCode: couponGst.code,
    });
    check(calcGstWithCoupon.summary.subtotal === 999, "A.5 Gross subtotal remains ₹999 before coupon discount");
    check(calcGstWithCoupon.summary.discount === 150, "A.6 Product discount is ₹150");
    check(calcGstWithCoupon.summary.isFreeShippingEarned === true, "A.7 Free shipping preserved even though net total is ₹849 (< ₹999)");
    check(calcGstWithCoupon.summary.shipping === 0, "A.8 Shipping fee remains ₹0");
    check(calcGstWithCoupon.summary.total === 849, "A.9 Total payable is ₹849 (999 - 150 + 0)");

    // ─────────────────────────────────────────────────────────────────────────────
    // GROUP B: ACTUAL COLOUR AND SIZE VARIANTS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[GROUP B: ACTUAL COLOUR AND SIZE VARIANTS]");

    const catVariants = await Category.create({
      name: `Variants Cat ${timestamp}`,
      slug: `variants-cat-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 1400,
    });
    cleanupCategoryIds.push(catVariants._id as mongoose.Types.ObjectId);

    // Product with distinct colour & size combinations and additional prices:
    // Variant 1: Size M, Black, basePrice ₹400 (+0) = ₹400
    // Variant 2: Size L, Black, basePrice ₹400 (+50) = ₹450
    // Variant 3: Size L, White, basePrice ₹400 (+100) = ₹500
    const prodMulti = await createTestProduct({
      name: `Multi SKU Tee ${timestamp}`,
      basePrice: 400,
      categoryId: catVariants._id,
      variants: [
        { size: "M", color: "Black", additionalPrice: 0, stock: 50 },
        { size: "L", color: "Black", additionalPrice: 50, stock: 50 },
        { size: "L", color: "White", additionalPrice: 100, stock: 50 },
      ],
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodMulti.productId));

    // Cart contains 3 distinct lines of the SAME productId with different color/size variants:
    // Line 1: M Black (qty: 1 @ 400 = 400)
    // Line 2: L Black (qty: 1 @ 450 = 450)
    // Line 3: L White (qty: 2 @ 500 = 1000)
    // Expected Category Total = 400 + 450 + 1000 = 1,850 >= 1,400 (Qualifies!)
    const calcVariants = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodMulti.productId, variantId: prodMulti.variantIds[0], quantity: 1 },
        { productId: prodMulti.productId, variantId: prodMulti.variantIds[1], quantity: 1 },
        { productId: prodMulti.productId, variantId: prodMulti.variantIds[2], quantity: 2 },
      ],
    });

    check(calcVariants.items.length === 3, "B.1 Exactly 3 distinct cart lines returned (not deduplicated by productId)");
    check(calcVariants.items[0].lineTotal === 400, "B.2 Variant M Black priced accurately at ₹400");
    check(calcVariants.items[1].lineTotal === 450, "B.3 Variant L Black (+50) priced accurately at ₹450");
    check(calcVariants.items[2].lineTotal === 1000, "B.4 Variant L White (+100, qty 2) priced accurately at ₹1,000");
    check(calcVariants.summary.subtotal === 1850, "B.5 Category subtotal accurately sums all variant lines (₹1,850)");
    check(calcVariants.summary.isFreeShippingEarned === true, "B.6 Category free delivery qualified (1850 >= 1400)");

    // ─────────────────────────────────────────────────────────────────────────────
    // GROUP C: CUSTOMIZATION AND VOLUME PRICING
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[GROUP C: CUSTOMIZATION AND VOLUME PRICING INTEGRITY]");

    const catCustom = await Category.create({
      name: `Custom Cat ${timestamp}`,
      slug: `custom-cat-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 4000,
    });
    cleanupCategoryIds.push(catCustom._id as mongoose.Types.ObjectId);

    const prodCustomBlank = await createTestProduct({
      name: `Custom Blank ${timestamp}`,
      basePrice: 300,
      categoryId: catCustom._id,
      variants: [{ size: "FREE", color: "BLACK", additionalPrice: 0, stock: 100 }],
    });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodCustomBlank.productId));

    // Custom configuration: 12 units total (qualifies for 10% volume discount in PricingService)
    // 12 units * (300 base + 200 printLocationFee) = 12 * 500 = ₹6,000
    // 10% volume discount = -₹600
    // Net customized line total = ₹5,400 >= 4000 (Qualifies!)
    const customConfig = {
      color: "BLACK",
      variantId: new mongoose.Types.ObjectId(prodCustomBlank.variantIds[0]),
      sizeDistribution: [
        { size: "M", quantity: 6 },
        { size: "L", quantity: 6 },
      ],
    };

    const calcCustom = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        {
          productId: prodCustomBlank.productId,
          variantId: prodCustomBlank.variantIds[0],
          quantity: 12,
          isCustomized: true,
          customConfigurations: [customConfig],
        },
      ],
    });
    check(calcCustom.items[0].pricingSnapshot?.bulkDiscount === 600, "C.1 PricingService volume discount (10% = ₹600) respected");
    check(calcCustom.summary.subtotal === 5400, "C.3 Category subtotal uses server-calculated customized total (₹5,400)");
    check(calcCustom.summary.isFreeShippingEarned === true, "C.4 Category threshold qualified with customized line (5400 >= 4000)");

    // ─────────────────────────────────────────────────────────────────────────────
    // GROUP D: ROOT AND CHILD CATEGORY EDGE CASES
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[GROUP D: ROOT & CHILD CATEGORY EDGE CASES]");

    const rootApparel = await Category.create({
      name: `Apparel Root ${timestamp}`,
      slug: `apparel-root-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 2000,
    });
    const childTees = await Category.create({
      name: `Tees Child ${timestamp}`,
      slug: `tees-child-${timestamp}`,
      parentCategory: rootApparel._id,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 800,
    });
    const childHoodies = await Category.create({
      name: `Hoodies Child ${timestamp}`,
      slug: `hoodies-child-${timestamp}`,
      parentCategory: rootApparel._id,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 1500,
    });
    const unrelatedRoot = await Category.create({
      name: `Accessories Root ${timestamp}`,
      slug: `accessories-root-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: true,
      freeShippingMinAmount: 500,
    });
    cleanupCategoryIds.push(
      rootApparel._id as mongoose.Types.ObjectId,
      childTees._id as mongoose.Types.ObjectId,
      childHoodies._id as mongoose.Types.ObjectId,
      unrelatedRoot._id as mongoose.Types.ObjectId
    );

    const { product: prodTee } = await createTestProduct({ name: `Tee ${timestamp}`, basePrice: 600, categoryId: childTees._id });
    const { product: prodHoodie } = await createTestProduct({ name: `Hoodie ${timestamp}`, basePrice: 1200, categoryId: childHoodies._id });
    const { product: prodApparelDirect } = await createTestProduct({ name: `Apparel Direct ${timestamp}`, basePrice: 400, categoryId: rootApparel._id });
    const { product: prodAccessory } = await createTestProduct({ name: `Accessory ${timestamp}`, basePrice: 300, categoryId: unrelatedRoot._id });
    cleanupProductIds.push(
      new mongoose.Types.ObjectId(prodTee._id),
      new mongoose.Types.ObjectId(prodHoodie._id),
      new mongoose.Types.ObjectId(prodApparelDirect._id),
      new mongoose.Types.ObjectId(prodAccessory._id)
    );

    // Turn off global free delivery to test pure hierarchy rules
    await StoreShippingConfig.updateOne({ key: DEFAULT_SHIPPING_CONFIG_KEY }, { $set: { isGlobalFreeShippingActive: false } });

    // D.1 Child qualifies independently
    const calcChildIndep = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodTee._id, variantId: prodTee.variants[0]._id, quantity: 2 }], // 600 * 2 = 1200 >= 800 childTees
    });
    check(calcChildIndep.summary.isFreeShippingEarned === true, "D.1 Child category qualifies independently (1200 >= 800)");
    check(calcChildIndep.summary.qualifyingCategoryNames.includes(childTees.name), "D.2 Child category name returned in qualifiers");

    // D.2 Root qualifies via roll-up while no individual child qualifies:
    // Tee (₹600 < 800) + Hoodie (₹1200 < 1500) + Direct Apparel (₹400) = ₹2,200 in Apparel Root (>= 2000)!
    const calcRootRollup = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodTee._id, variantId: prodTee.variants[0]._id, quantity: 1 },         // 600
        { productId: prodHoodie._id, variantId: prodHoodie.variants[0]._id, quantity: 1 },   // 1200
        { productId: prodApparelDirect._id, variantId: prodApparelDirect.variants[0]._id, quantity: 1 }, // 400
      ],
    });
    check(calcRootRollup.summary.isFreeShippingEarned === true, "D.3 Root qualifies using direct items + multiple child items (2,200 >= 2,000)");
    check(calcRootRollup.summary.qualifyingCategoryNames.includes(rootApparel.name), "D.4 Root category name identified as qualifier");
    check(!calcRootRollup.summary.qualifyingCategoryNames.includes(childTees.name), "D.5 Child tees (600 < 800) did not qualify on its own");
    check(!calcRootRollup.summary.qualifyingCategoryNames.includes(childHoodies.name), "D.6 Child hoodies (1200 < 1500) did not qualify on its own");

    // D.3 Unrelated root categories never share subtotals:
    // Apparel Direct (₹400 < 2000) + Accessory (₹300 < 500) = 700. Neither qualifies!
    const calcNoUnrelatedShare = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prodApparelDirect._id, variantId: prodApparelDirect.variants[0]._id, quantity: 1 }, // 400
        { productId: prodAccessory._id, variantId: prodAccessory.variants[0]._id, quantity: 1 },         // 300
      ],
    });
    check(calcNoUnrelatedShare.summary.isFreeShippingEarned === false, "D.7 Unrelated root categories never share subtotals (400 + 300 cannot qualify either)");
    check(calcNoUnrelatedShare.summary.shipping === 100, "D.8 Standard fee charged when unrelated categories do not qualify");

    await StoreShippingConfig.updateOne({ key: DEFAULT_SHIPPING_CONFIG_KEY }, { $set: { isGlobalFreeShippingActive: true } });

    // ─────────────────────────────────────────────────────────────────────────────
    // GROUP E: PRICING FINGERPRINT INVARIANTS & 409 PROTECTION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[GROUP E: PRICING FINGERPRINT INVARIANTS & 409]");

    const fpCalcInit = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodTee._id, variantId: prodTee.variants[0]._id, quantity: 1 }],
    });
    const initialFp = fpCalcInit.summary.pricingFingerprint;

    // Mutating child category threshold from 800 to 1000 invalidates fingerprint
    await Category.updateOne({ _id: childTees._id }, { $set: { freeShippingMinAmount: 1000 } });
    const fpCalcMutated = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodTee._id, variantId: prodTee.variants[0]._id, quantity: 1 }],
    });
    check(fpCalcMutated.summary.pricingFingerprint !== initialFp, "E.1 Fingerprint invalidates when category threshold changes");

    // Disabling category free shipping invalidates fingerprint
    await Category.updateOne({ _id: childTees._id }, { $set: { isFreeShippingEnabled: false } });
    const fpCalcDisabled = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodTee._id, variantId: prodTee.variants[0]._id, quantity: 1 }],
    });
    check(fpCalcDisabled.summary.pricingFingerprint !== initialFp, "E.2 Fingerprint invalidates when category rule is disabled");

    // Reset child tees
    await Category.updateOne({ _id: childTees._id }, { $set: { isFreeShippingEnabled: true, freeShippingMinAmount: 800 } });

    // ─────────────────────────────────────────────────────────────────────────────
    // GROUP F: CART PREVIEW AND ORDER CREATION CONSISTENCY
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[GROUP F: CART PREVIEW & ORDER CREATION CONSISTENCY]");

    const userConsistency = await User.create({
      name: `Consistency User ${timestamp}`,
      email: `consistency_${timestamp}@example.com`,
      passwordHash: "dummy_hash",
      role: UserRole.CUSTOMER,
    });
    cleanupUserIds.push(userConsistency._id as mongoose.Types.ObjectId);

    const userAddr = await Address.create({
      userId: userConsistency._id,
      fullName: "Consistency Tester",
      phone: "9876543210",
      addressLine1: "123 Consistency St",
      city: "New Delhi",
      state: "Delhi",
      postalCode: "110020",
      country: "India",
      addressType: "HOME",
    });

    const userCart = await Cart.create({
      userId: userConsistency._id,
      items: [
        { productId: prodTee._id, variantId: prodTee.variants[0]._id, quantity: 2 }, // 600 * 2 = 1,200 (Qualifies for childTees >= 800)
      ],
      couponCode: couponGst.code, // ₹150 off
    });

    // 1. Authoritative Cart Preview Calculation
    const previewCalc = await PricingEngineService.calculate({
      userId: userConsistency._id.toString(),
      items: userCart.items,
      couponCode: userCart.couponCode,
    });

    check(previewCalc.summary.subtotal === 1200, "F.1 Cart preview subtotal is ₹1,200");
    check(previewCalc.summary.discount === 150, "F.2 Cart preview discount is ₹150");
    check(previewCalc.summary.shipping === 0, "F.3 Cart preview shipping is ₹0");
    check(previewCalc.summary.total === 1050, "F.4 Cart preview total is ₹1,050 (1200 - 150 + 0)");
    check(previewCalc.summary.freeShippingSource === "GLOBAL_THRESHOLD", "F.5 Cart preview free shipping source is GLOBAL_THRESHOLD");

    // 2. Order Creation with Client Tampered Fields (Tampered subtotal, shipping, total)
    const tamperedOrderReq = {
      user: { id: userConsistency._id.toString(), role: "CUSTOMER" },
      body: {
        addressId: userAddr._id.toString(),
        clientPricingFingerprint: previewCalc.summary.pricingFingerprint,
        subtotal: 10,
        shipping: 500, // Client attempts to force ₹500 shipping or ₹10 subtotal
        total: 1,
        isFreeShippingEarned: false,
      },
    } as unknown as Request;
    const orderRes = createMockRes();

    await createOrder(tamperedOrderReq, orderRes as unknown as Response, () => {});
    check(orderRes.statusCode === 201, "F.6 Order created successfully (HTTP 201)");
    const createdOrder = orderRes.body?.data as Record<string, unknown>;

    // 3. Exact Mathematical Equality Check between Preview and Created Order
    check(createdOrder.subtotal === previewCalc.summary.subtotal, "F.7 Order subtotal exactly matches preview (₹1,200)");
    check(createdOrder.discount === previewCalc.summary.discount, "F.8 Order discount exactly matches preview (₹150)");
    check(createdOrder.shipping === previewCalc.summary.shipping, "F.9 Order shipping exactly matches preview (₹0, tampered ₹500 ignored)");
    check(createdOrder.total === previewCalc.summary.total, "F.10 Order total exactly matches preview (₹1,050, tampered ₹1 ignored)");
    check(createdOrder.couponCode === couponGst.code, "F.11 Order coupon code recorded accurately");

    // 4. Stale Fingerprint Rejection (HTTP 409)
    const staleOrderReq = {
      user: { id: userConsistency._id.toString(), role: "CUSTOMER" },
      body: {
        addressId: userAddr._id.toString(),
        clientPricingFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    } as unknown as Request;
    const staleOrderRes = createMockRes();
    await createOrder(staleOrderReq, staleOrderRes as unknown as Response, () => {});
    check(staleOrderRes.statusCode === 409, "F.12 Stale fingerprint rejected with HTTP 409 PRICING_CHANGED");

    // ─────────────────────────────────────────────────────────────────────────────
    // GROUP G: ACTUAL MOUNTED ROUTE SECURITY VIA EPHEMERAL HTTP SERVER
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[GROUP G: ACTUAL ROUTE INTEGRATION VIA EPHEMERAL HTTP SERVER]");

    const adminTestUser = await User.create({
      name: `Admin Category Tester ${timestamp}`,
      email: `admintest_${timestamp}@example.com`,
      passwordHash: "dummy_hash",
      role: UserRole.ADMIN,
    });
    cleanupUserIds.push(adminTestUser._id as mongoose.Types.ObjectId);

    const catHttpTest = await Category.create({
      name: `HTTP Test Cat ${timestamp}`,
      slug: `http-test-cat-${timestamp}`,
      status: CategoryStatus.ACTIVE,
    });
    cleanupCategoryIds.push(catHttpTest._id as mongoose.Types.ObjectId);

    const jwtSecret = getJwtAccessSecret();
    const adminJwt = jwt.sign({ sub: adminTestUser._id.toString(), role: UserRole.ADMIN }, jwtSecret, { algorithm: "HS256", expiresIn: "1h" });
    const customerJwt = jwt.sign({ sub: userConsistency._id.toString(), role: UserRole.CUSTOMER }, jwtSecret, { algorithm: "HS256", expiresIn: "1h" });

    // Setup an ephemeral Express HTTP test server mounting actual adminCatalogRoutes
    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api/admin", adminCatalogRoutes);
    testApp.use(errorHandler);
    testHttpServer = http.createServer(testApp);
    await new Promise<void>((resolve) => testHttpServer!.listen(0, resolve));
    const address = testHttpServer.address() as net.AddressInfo;
    const baseApiUrl = `http://127.0.0.1:${address.port}/api/admin/categories`;

    // G.1 Unauthenticated Request to Real HTTP Server
    const unauthHttpRes = await fetch(`${baseApiUrl}/${catHttpTest._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: 900 }),
    });
    check(unauthHttpRes.status === 401, "G.1 Unauthenticated request to real mounted route receives HTTP 401");
    // G.2 Customer Request to Real HTTP Server
    const customerHttpRes = await fetch(`${baseApiUrl}/${catHttpTest._id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${customerJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: 900 }),
    });
    check(customerHttpRes.status === 403, "G.2 Customer role request to real mounted route receives HTTP 403");

    // G.3 Negative Threshold Request by Admin to Real HTTP Server
    const negativeHttpRes = await fetch(`${baseApiUrl}/${catHttpTest._id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: -50 }),
    });
    check(negativeHttpRes.status === 400, "G.3 Negative threshold rejected by schema with HTTP 400");

    // G.4 Non-Numeric Threshold Request by Admin to Real HTTP Server
    const nonNumericHttpRes = await fetch(`${baseApiUrl}/${catHttpTest._id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: "not_a_number" }),
    });
    check(nonNumericHttpRes.status === 400, "G.4 Non-numeric threshold rejected by schema with HTTP 400");

    // G.5 Authorized Admin Update to Real HTTP Server
    const validHttpRes = await fetch(`${baseApiUrl}/${catHttpTest._id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isFreeShippingEnabled: true, freeShippingMinAmount: 1399 }),
    });
    check(validHttpRes.status === 200, "G.5 Authorized admin update to real mounted route receives HTTP 200");

    // Verify persistence in MongoDB
    const persistedCat = await Category.findById(catHttpTest._id);
    check(persistedCat?.isFreeShippingEnabled === true, "G.6 Category isFreeShippingEnabled persisted as true");
    check(persistedCat?.freeShippingMinAmount === 1399, "G.7 Category freeShippingMinAmount persisted as ₹1,399");

    // Verify AuditLog written
    const auditRecord = await AuditLog.findOne({
      action: "ADMIN_CATEGORY_UPDATED",
      entityId: catHttpTest._id,
      actorId: adminTestUser._id,
    }).sort({ createdAt: -1 });

    check(Boolean(auditRecord), "G.8 AuditLog written for admin category shipping update");
    check(auditRecord?.metadata?.previous?.isFreeShippingEnabled === false, "G.9 AuditLog captures exact previous isFreeShippingEnabled (false)");
    check(auditRecord?.metadata?.updated?.isFreeShippingEnabled === true, "G.10 AuditLog captures exact updated isFreeShippingEnabled (true)");
    check(auditRecord?.metadata?.updated?.freeShippingMinAmount === 1399, "G.11 AuditLog captures exact updated threshold (1399)");

    // G.12 POST /categories: Creating an enabled category without threshold returns HTTP 400
    const createNoThresholdRes = await fetch(baseApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Enabled No Threshold ${timestamp}`,
        slug: `enabled-no-thresh-${timestamp}`,
        isFreeShippingEnabled: true,
        // freeShippingMinAmount omitted
      }),
    });
    check(createNoThresholdRes.status === 400, "G.12 Creating enabled category without threshold returns HTTP 400");

    // G.13 POST /categories: Explicit threshold zero (0) is accepted on creation (HTTP 201)
    const createZeroThresholdRes = await fetch(baseApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Explicit Zero Cat ${timestamp}`,
        slug: `explicit-zero-cat-${timestamp}`,
        isFreeShippingEnabled: true,
        freeShippingMinAmount: 0,
      }),
    });
    check(createZeroThresholdRes.status === 201, "G.13 Explicit threshold zero is accepted on creation (HTTP 201)");
    const createdZeroBody = (await createZeroThresholdRes.json()) as { data?: { _id: string; freeShippingMinAmount: number } };
    check(createdZeroBody?.data?.freeShippingMinAmount === 0, "G.14 Zero threshold persisted as 0 in MongoDB");
    if (createdZeroBody?.data?._id) cleanupCategoryIds.push(new mongoose.Types.ObjectId(createdZeroBody.data._id));

    // G.15 PUT /categories/:id: Enabling existing disabled category without threshold returns HTTP 400
    const disabledCatForEnableTest = await Category.create({
      name: `Disabled To Enable ${timestamp}`,
      slug: `disabled-to-enable-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      isFreeShippingEnabled: false,
    });
    cleanupCategoryIds.push(disabledCatForEnableTest._id as mongoose.Types.ObjectId);

    const enableNoThresholdRes = await fetch(`${baseApiUrl}/${disabledCatForEnableTest._id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isFreeShippingEnabled: true,
        // freeShippingMinAmount omitted
      }),
    });
    check(enableNoThresholdRes.status === 400, "G.15 Enabling existing disabled category without threshold returns HTTP 400");

    // G.16 PUT /categories/:id: Updating unrelated fields preserves existing threshold
    const updateUnrelatedRes = await fetch(`${baseApiUrl}/${catHttpTest._id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Renamed HTTP Test Cat ${timestamp}`,
        description: "Updated description only",
      }),
    });
    check(updateUnrelatedRes.status === 200, "G.16 Updating unrelated fields succeeds with HTTP 200");
    const persistedAfterUnrelated = await Category.findById(catHttpTest._id);
    check(persistedAfterUnrelated?.isFreeShippingEnabled === true, "G.17 Unrelated update preserves isFreeShippingEnabled = true");
    check(persistedAfterUnrelated?.freeShippingMinAmount === 1399, "G.18 Unrelated update preserves existing threshold = 1399 (not reset to 0)");

    // G.17 PUT /categories/:id: Disabling category shipping preserves its configured threshold
    const disableShippingRes = await fetch(`${baseApiUrl}/${catHttpTest._id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isFreeShippingEnabled: false,
        // freeShippingMinAmount omitted to verify threshold preservation
      }),
    });
    check(disableShippingRes.status === 200, "G.19 Disabling category free shipping succeeds with HTTP 200");
    const persistedAfterDisable = await Category.findById(catHttpTest._id);
    check(persistedAfterDisable?.isFreeShippingEnabled === false, "G.20 Category is now disabled");
    check(persistedAfterDisable?.freeShippingMinAmount === 1399, "G.21 Disabling free shipping preserves configured threshold (1399 retained)");

  } catch (err: unknown) {
    console.error("Test execution threw exception:", err);
    failed++;
    failures.push(String(err));
  } finally {
    if (testHttpServer) {
      await new Promise<void>((resolve) => testHttpServer!.close(() => resolve()));
    }
    console.log("\n🧹 Cleaning up test fixtures from database...");
    await Category.deleteMany({ _id: { $in: cleanupCategoryIds } });
    await Product.deleteMany({ _id: { $in: cleanupProductIds } });
    await Coupon.deleteMany({ _id: { $in: cleanupCouponIds } });
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
    await Address.deleteMany({ userId: { $in: cleanupUserIds } });
    await Cart.deleteMany({ userId: { $in: cleanupUserIds } });
    await Order.deleteMany({ userId: { $in: cleanupUserIds } });
    await AuditLog.deleteMany({ entityId: { $in: cleanupCategoryIds } });
    await StoreShippingConfig.deleteMany({});
    await mongoose.disconnect();
    console.log(" Disconnected from MongoDB\n");
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Stage B Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(` - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════");

  if (failed > 0) {
    process.exit(1);
  }
}

runStageBTests();
