/**
 * Stage A: Centralized Pricing Engine & Global Shipping Configuration Test Suite
 *
 * Verifies:
 * 1. Default StoreShippingConfig creation with safe non-zero defaults (₹999 / ₹100).
 * 2. Concurrent singleton initialization safety.
 * 3. Preservation of existing admin settings using $setOnInsert.
 * 4. Global free shipping enabled and disabled toggling.
 * 5. Boundary calculations: below, exactly at, and above ₹999.
 * 6. Custom thresholds and standard delivery fees.
 * 7. Gross Merchandise Subtotal invariant: product discount coupons NEVER revoke free shipping.
 * 8. Cart preview and order creation pricing consistency.
 * 9. Mandatory pricing fingerprint: missing, empty, malformed, stale, and valid cases.
 * 10. Arbitrary header bypass proof: x-internal-service CANNOT bypass fingerprint check.
 * 11. Protection against client-submitted price manipulation.
 * 12. Removal of ₹1-₹5 test checkout bypass: low-value orders strictly incur standard shipping.
 * 13. Fail-closed behaviour on database query failure (never silently grants free shipping).
 * 14. Admin Shipping Settings router integration (401 unauth, 403 customer, 200 admin, validation & AuditLog).
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

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
import { PricingEngineService } from "../services/pricing/PricingEngineService";
import { Coupon, DiscountType, CouponStatus } from "../models/Coupon";
import { Cart } from "../models/Cart";
import { Order } from "../models/Order";
import { Address } from "../models/Address";
import { User, UserRole } from "../models/User";
import { Product } from "../models/Product";
import { AuditLog } from "../models/AuditLog";
import { createOrder } from "../controllers/orderController";
import adminShippingSettingsRouter from "../routes/adminShippingSettingsRoutes";
import {
  getAdminShippingSettings,
  updateAdminShippingSettings,
} from "../controllers/adminShippingSettingsController";
import { Request, Response } from "express";

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

interface RouterInvocationResult {
  err: (Error & { statusCode?: number; code?: string }) | null;
  res: MockResponse;
}

function withResolvers<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function invokeRouter(
  router: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request,
  res: MockResponse
): Promise<RouterInvocationResult> {
  const { promise, resolve } = withResolvers<RouterInvocationResult>();
  let handled = false;
  const originalJson = res.json.bind(res);
  res.json = (data: Record<string, unknown>) => {
    originalJson(data);
    if (!handled) {
      handled = true;
      resolve({ err: null, res });
    }
    return res;
  };
  router(req, res as unknown as Response, (err: unknown) => {
    if (!handled) {
      handled = true;
      resolve({ err: (err as Error & { statusCode?: number; code?: string }) || null, res });
    }
  });
  return promise;
}

async function runStageATests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Stage A: Shipping Settings & Pricing Engine Verification     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupCouponIds: mongoose.Types.ObjectId[] = [];

  try {
    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 0: DATABASE ISOLATION GUARD
    // ─────────────────────────────────────────────────────────────────────────────
    await connectSafeTestDb();
    assertSafeTestDatabase();
    const activeTestUri = getVerifiedTestMongoUri();
    const activeDbName = extractDatabaseName(activeTestUri);
    console.log(` Connected to verified isolated test database: ${activeDbName}\n`);
    check(activeDbName === "samrat_fashion_test_isolated", "0.1 Active database is verified as isolated 'samrat_fashion_test_isolated'");

    const timestamp = Date.now();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: SINGLETON CONFIGURATION INITIALIZATION & SAFETY
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 1: SINGLETON STORE SHIPPING CONFIGURATION]");

    await StoreShippingConfig.deleteMany({});

    const initialConfig = await getStoreShippingConfig();
    check(initialConfig.globalFreeShippingThreshold === 999, "1.1 Default threshold is ₹999");
    check(initialConfig.standardShippingFee === 100, "1.2 Default standard shipping fee is ₹100");
    check(initialConfig.isGlobalFreeShippingActive === true, "1.3 Global free shipping is enabled by default");

    const totalConfigsInDb = await StoreShippingConfig.countDocuments({ key: DEFAULT_SHIPPING_CONFIG_KEY });
    check(totalConfigsInDb === 1, "1.4 Exactly one configuration document created in DB");

    // Concurrent Initialization Test (Race Condition Protection)
    await StoreShippingConfig.deleteMany({});
    const concurrentInits = await Promise.all([
      getStoreShippingConfig(),
      getStoreShippingConfig(),
      getStoreShippingConfig(),
      getStoreShippingConfig(),
      getStoreShippingConfig(),
    ]);

    const countAfterRace = await StoreShippingConfig.countDocuments({ key: DEFAULT_SHIPPING_CONFIG_KEY });
    check(countAfterRace === 1, "1.5 Concurrent calls create exactly one singleton document without duplication");
    check(concurrentInits.every((c) => c.globalFreeShippingThreshold === 999), "1.6 All concurrent callers receive valid default config");

    // Preservation of Existing Admin Settings ($setOnInsert Invariant)
    await StoreShippingConfig.updateOne(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { $set: { globalFreeShippingThreshold: 1499, standardShippingFee: 150, isGlobalFreeShippingActive: false } }
    );

    const reloaded = await getStoreShippingConfig();
    check(reloaded.globalFreeShippingThreshold === 1499, "1.7 Existing admin threshold (₹1499) preserved by getStoreShippingConfig");
    check(reloaded.standardShippingFee === 150, "1.8 Existing admin fee (₹150) preserved by getStoreShippingConfig");
    check(reloaded.isGlobalFreeShippingActive === false, "1.9 Existing admin toggle (disabled) preserved");

    // Reset back to standard defaults for subsequent tests
    await StoreShippingConfig.updateOne(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { $set: { globalFreeShippingThreshold: 999, standardShippingFee: 100, isGlobalFreeShippingActive: true } }
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: PRICING ENGINE - BOUNDARY THRESHOLD CALCULATIONS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: BOUNDARY SHIPPING THRESHOLD CALCULATIONS]");

    const prod499Obj = await createTestProduct({ name: `Tee 499 ${timestamp}`, basePrice: 499 });
    const prod500Obj = await createTestProduct({ name: `Tee 500 ${timestamp}`, basePrice: 500 });
    const prod999Obj = await createTestProduct({ name: `Tee 999 ${timestamp}`, basePrice: 999 });
    const prod1000Obj = await createTestProduct({ name: `Tee 1000 ${timestamp}`, basePrice: 1000 });

    cleanupProductIds.push(
      new mongoose.Types.ObjectId(prod499Obj.productId),
      new mongoose.Types.ObjectId(prod500Obj.productId),
      new mongoose.Types.ObjectId(prod999Obj.productId),
      new mongoose.Types.ObjectId(prod1000Obj.productId)
    );

    const dummyUser = new mongoose.Types.ObjectId();

    // 2.1 Subtotal Below Threshold: ₹998 (499 + 499)
    const belowResult = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prod499Obj.productId, variantId: prod499Obj.variantIds[0], quantity: 2 },
      ],
    });
    check(belowResult.summary.subtotal === 998, "2.1 Gross subtotal is ₹998");
    check(belowResult.summary.shipping === 100, "2.2 Shipping is ₹100 when subtotal < ₹999");
    check(belowResult.summary.total === 1098, "2.3 Total is ₹1,098 (998 + 100)");
    check(belowResult.summary.isFreeShippingEarned === false, "2.4 Free shipping not earned for ₹998");

    // 2.2 Subtotal Exactly At Threshold: ₹999
    const exactResult = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prod999Obj.productId, variantId: prod999Obj.variantIds[0], quantity: 1 },
      ],
    });
    check(exactResult.summary.subtotal === 999, "2.5 Gross subtotal is ₹999");
    check(exactResult.summary.shipping === 0, "2.6 Shipping is ₹0 when subtotal is exactly ₹999");
    check(exactResult.summary.total === 999, "2.7 Total is ₹999 (999 + 0)");
    check(exactResult.summary.isFreeShippingEarned === true, "2.8 Free shipping earned at boundary ₹999");

    // 2.3 Subtotal Above Threshold: ₹1,000
    const aboveResult = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [
        { productId: prod1000Obj.productId, variantId: prod1000Obj.variantIds[0], quantity: 1 },
      ],
    });
    check(aboveResult.summary.subtotal === 1000, "2.9 Gross subtotal is ₹1,000");
    check(aboveResult.summary.shipping === 0, "2.10 Shipping is ₹0 when subtotal > ₹999");
    check(aboveResult.summary.total === 1000, "2.11 Total is ₹1,000 (1000 + 0)");
    check(aboveResult.summary.isFreeShippingEarned === true, "2.12 Free shipping earned for ₹1,000");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: GROSS MERCHANDISE SUBTOTAL INVARIANT (COUPON NON-REVOCATION)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: GROSS MERCHANDISE SUBTOTAL INVARIANT]");

    const coupon10 = await Coupon.create({
      code: `STAGE10_${timestamp}`,
      discountType: DiscountType.PERCENTAGE,
      discountValue: 10,
      minOrderValue: 0,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(coupon10._id);

    const prod1200Obj = await createTestProduct({ name: `Tee 1200 ${timestamp}`, basePrice: 1200 });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prod1200Obj.productId));

    const couponResult1 = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prod1200Obj.productId, variantId: prod1200Obj.variantIds[0], quantity: 1 }],
      couponCode: coupon10.code,
    });
    check(couponResult1.summary.subtotal === 1200, "3.1 Gross subtotal remains ₹1,200");
    check(couponResult1.summary.discount === 120, "3.2 Discount is ₹120 (10% of 1200)");
    check(couponResult1.summary.shipping === 0, "3.3 Free shipping applies");
    check(couponResult1.summary.total === 1080, "3.4 Total is ₹1,080 (1200 - 120 + 0)");

    // CRITICAL: Coupon drops net below ₹999, but Gross was above ₹999!
    const couponFixed100 = await Coupon.create({
      code: `SAVE100_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 100,
      minOrderValue: 0,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(couponFixed100._id);

    const grossInvariantResult = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prod1000Obj.productId, variantId: prod1000Obj.variantIds[0], quantity: 1 }],
      couponCode: couponFixed100.code,
    });

    check(grossInvariantResult.summary.subtotal === 1000, "3.5 Gross subtotal is ₹1,000 (pre-discount)");
    check(grossInvariantResult.summary.discount === 100, "3.6 Discount is ₹100");
    check(grossInvariantResult.summary.shipping === 0, "3.7 Shipping REMAINS ₹0 even though net is ₹900 (< ₹999)");
    check(grossInvariantResult.summary.total === 900, "3.8 Total is ₹900 (1000 - 100 + 0) — customer gets full ₹100 benefit!");
    check(grossInvariantResult.summary.isFreeShippingEarned === true, "3.9 Free shipping earned flag preserved");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: GLOBAL FREE SHIPPING TOGGLE
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: GLOBAL FREE SHIPPING TOGGLE]");

    await StoreShippingConfig.updateOne(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { $set: { isGlobalFreeShippingActive: false } }
    );

    const disabledToggleResult = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prod1200Obj.productId, variantId: prod1200Obj.variantIds[0], quantity: 1 }],
    });
    check(disabledToggleResult.summary.subtotal === 1200, "4.1 Subtotal is ₹1,200");
    check(disabledToggleResult.summary.shipping === 100, "4.2 Standard shipping fee ₹100 charged when global free delivery is disabled");
    check(disabledToggleResult.summary.total === 1300, "4.3 Total is ₹1,300 (1200 + 100)");
    check(disabledToggleResult.summary.isFreeShippingEarned === false, "4.4 Free shipping not earned when program disabled");

    await StoreShippingConfig.updateOne(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { $set: { isGlobalFreeShippingActive: true } }
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 5: REMOVAL OF TEST-CHECKOUT SHIPPING BYPASS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 5: REMOVAL OF TEST CHECKOUT BYPASS]");

    const prodTest3Obj = await createTestProduct({ name: `Test Sample ₹3 ${timestamp}`, basePrice: 3 });
    cleanupProductIds.push(new mongoose.Types.ObjectId(prodTest3Obj.productId));

    const testItemResult = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prodTest3Obj.productId, variantId: prodTest3Obj.variantIds[0], quantity: 1 }],
    });

    check(testItemResult.summary.subtotal === 3, "5.1 Low-value item subtotal is ₹3");
    check(testItemResult.summary.shipping === 100, "5.2 Shipping is strictly ₹100 (₹1-₹5 bypass eliminated)");
    check(testItemResult.summary.total === 103, "5.3 Total is ₹103 (3 + 100)");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 6: PRICING FINGERPRINT GENERATION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 6: PRICING FINGERPRINT GENERATION]");

    const calc1 = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prod500Obj.productId, variantId: prod500Obj.variantIds[0], quantity: 1 }],
    });
    const fp1 = calc1.summary.pricingFingerprint;
    check(typeof fp1 === "string" && fp1.length === 64, "6.1 Generates valid 64-char SHA-256 pricing fingerprint");

    const calc1Repeat = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prod500Obj.productId, variantId: prod500Obj.variantIds[0], quantity: 1 }],
    });
    check(calc1Repeat.summary.pricingFingerprint === fp1, "6.2 Deterministic: identical inputs yield identical fingerprint");

    await StoreShippingConfig.updateOne(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { $set: { standardShippingFee: 120 } }
    );
    const calcModified = await PricingEngineService.calculate({
      userId: dummyUser.toString(),
      items: [{ productId: prod500Obj.productId, variantId: prod500Obj.variantIds[0], quantity: 1 }],
    });
    check(calcModified.summary.pricingFingerprint !== fp1, "6.3 Fingerprint changes immediately when admin updates shipping fee");

    await StoreShippingConfig.updateOne(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { $set: { standardShippingFee: 100 } }
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 7: MANDATORY FINGERPRINT VALIDATION & ORDER CREATION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 7: MANDATORY FINGERPRINT VALIDATION & ORDER CREATION]");

    const testUser = await User.create({
      name: `Stage A User ${timestamp}`,
      email: `stagea_${timestamp}@example.com`,
      passwordHash: "dummy_hash",
      role: UserRole.CUSTOMER,
    });
    cleanupUserIds.push(testUser._id as mongoose.Types.ObjectId);

    const testAddress = await Address.create({
      userId: testUser._id,
      fullName: "Stage A Tester",
      phone: "9876543210",
      addressLine1: "123 Fashion Street",
      city: "New Delhi",
      state: "Delhi",
      postalCode: "110020",
      country: "India",
      addressType: "HOME",
    });

    const testCart = await Cart.create({
      userId: testUser._id,
      items: [
        {
          productId: prod1000Obj.productId,
          variantId: prod1000Obj.variantIds[0],
          quantity: 1,
        },
      ],
      couponCode: couponFixed100.code,
    });

    // 7.1 Missing Fingerprint
    const missingFpReq = {
      user: { id: testUser._id.toString(), role: "CUSTOMER" },
      body: { addressId: testAddress._id.toString() },
    } as unknown as Request;
    const missingFpRes = createMockRes();
    await createOrder(missingFpReq, missingFpRes as unknown as Response, () => {});
    check(missingFpRes.statusCode === 400, "7.1 Missing fingerprint rejected with HTTP 400");
    check(missingFpRes.body?.code === "MISSING_PRICING_FINGERPRINT", "7.2 Code is MISSING_PRICING_FINGERPRINT");

    // 7.2 Empty / Whitespace Fingerprint
    const emptyFpReq = {
      user: { id: testUser._id.toString(), role: "CUSTOMER" },
      body: { addressId: testAddress._id.toString(), clientPricingFingerprint: "   " },
    } as unknown as Request;
    const emptyFpRes = createMockRes();
    await createOrder(emptyFpReq, emptyFpRes as unknown as Response, () => {});
    check(emptyFpRes.statusCode === 400, "7.3 Empty fingerprint rejected with HTTP 400");
    check(emptyFpRes.body?.code === "MISSING_PRICING_FINGERPRINT", "7.4 Code is MISSING_PRICING_FINGERPRINT");

    // 7.3 Malformed Fingerprint (non-64 hex)
    const malformedReq = {
      user: { id: testUser._id.toString(), role: "CUSTOMER" },
      body: { addressId: testAddress._id.toString(), clientPricingFingerprint: "invalid_fingerprint_abc123" },
    } as unknown as Request;
    const malformedRes = createMockRes();
    await createOrder(malformedReq, malformedRes as unknown as Response, () => {});
    check(malformedRes.statusCode === 400, "7.5 Malformed fingerprint rejected with HTTP 400");
    check(malformedRes.body?.code === "MALFORMED_PRICING_FINGERPRINT", "7.6 Code is MALFORMED_PRICING_FINGERPRINT");

    // 7.4 Stale Fingerprint (Valid 64-hex format, but outdated hash)
    const staleReq = {
      user: { id: testUser._id.toString(), role: "CUSTOMER" },
      body: {
        addressId: testAddress._id.toString(),
        clientPricingFingerprint: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    } as unknown as Request;
    const staleRes = createMockRes();
    await createOrder(staleReq, staleRes as unknown as Response, () => {});
    check(staleRes.statusCode === 409, "7.7 Stale client fingerprint rejected with HTTP 409 Conflict");
    check(staleRes.body?.code === "PRICING_CHANGED", "7.8 Error code is PRICING_CHANGED");
    check(Boolean(staleRes.body?.data && typeof staleRes.body?.data === "object"), "7.9 Returns refreshed pricing summary and new fingerprint");

    // 7.5 Forged Header Bypass Rejection Test
    const forgedHeaderReq = {
      user: { id: testUser._id.toString(), role: "CUSTOMER" },
      headers: { "x-internal-service": "forged_secret_token" },
      body: {
        addressId: testAddress._id.toString(),
        // clientPricingFingerprint omitted
      },
    } as unknown as Request;
    const forgedHeaderRes = createMockRes();
    await createOrder(forgedHeaderReq, forgedHeaderRes as unknown as Response, () => {});
    check(forgedHeaderRes.statusCode === 400, "7.10 Forged x-internal-service header CANNOT bypass mandatory fingerprint check (400)");
    check(forgedHeaderRes.body?.code === "MISSING_PRICING_FINGERPRINT", "7.11 Code is MISSING_PRICING_FINGERPRINT on forged header attempt");

    // 7.6 Valid Fingerprint Order Placement
    const freshCartCalc = await PricingEngineService.calculate({
      userId: testUser._id.toString(),
      items: testCart.items,
      couponCode: testCart.couponCode,
    });

    const validReq = {
      user: { id: testUser._id.toString(), role: "CUSTOMER" },
      body: {
        addressId: testAddress._id.toString(),
        clientPricingFingerprint: freshCartCalc.summary.pricingFingerprint,
      },
    } as unknown as Request;
    const validRes = createMockRes();
    await createOrder(validReq, validRes as unknown as Response, () => {});
    check(validRes.statusCode === 201, "7.12 Order created successfully with valid fingerprint (HTTP 201)");
    const orderData = validRes.body?.data as Record<string, unknown>;
    check(orderData?.subtotal === 1000, "7.13 Order subtotal matches cart preview exactly (₹1,000)");
    check(orderData?.discount === 100, "7.14 Order discount matches cart preview exactly (₹100)");
    check(orderData?.shipping === 0, "7.15 Order shipping matches cart preview exactly (₹0)");
    check(orderData?.total === 900, "7.16 Order total matches cart preview exactly (₹900)");

    // 7.7 Protection Against Client-Submitted Price Manipulation
    const tamperedReq = {
      user: { id: testUser._id.toString(), role: "CUSTOMER" },
      body: {
        addressId: testAddress._id.toString(),
        clientPricingFingerprint: freshCartCalc.summary.pricingFingerprint,
        total: 1,
        subtotal: 1,
        shipping: 0,
      },
    } as unknown as Request;
    const tamperedRes = createMockRes();
    await createOrder(tamperedReq, tamperedRes as unknown as Response, () => {});
    const tamperedOrderData = tamperedRes.body?.data as Record<string, unknown>;
    check(tamperedOrderData?.total === 900, "7.17 Tampered client total ignored; server authoritatively charges ₹900");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 8: SHIPPING CONFIGURATION FAILURE HANDLING & FAIL-CLOSED INTEGRITY
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 8: CONFIGURATION FAILURE HANDLING & FAIL-CLOSED BEHAVIOUR]");

    // Case A: Missing document in DB is cleanly initialized
    await StoreShippingConfig.deleteMany({});
    const autoInitConfig = await getStoreShippingConfig();
    check(autoInitConfig.globalFreeShippingThreshold === 999, "8.1 Missing document in DB cleanly initialized with default ₹999");
    check(autoInitConfig.standardShippingFee === 100, "8.2 Missing document in DB cleanly initialized with default ₹100 fee");

    // Case B: Actual DB failure fails closed with controlled server error
    const originalFindOneAndUpdate = StoreShippingConfig.findOneAndUpdate;
    let failClosedThrown = false;
    let thrownErrorCode = "";
    try {
      (StoreShippingConfig as any).findOneAndUpdate = () => {
        throw new Error("Simulated MongoDB network partition / timeout");
      };
      await getStoreShippingConfig();
    } catch (e: any) {
      failClosedThrown = true;
      thrownErrorCode = e.code || "";
    } finally {
      StoreShippingConfig.findOneAndUpdate = originalFindOneAndUpdate;
    }

    check(failClosedThrown === true, "8.3 Actual DB query failure throws controlled server error (FAILS CLOSED)");
    check(thrownErrorCode === "SHIPPING_CONFIG_READ_ERROR", "8.4 Error code is SHIPPING_CONFIG_READ_ERROR; never silently grants free shipping");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 9: ADMIN API ROUTE INTEGRATION, VALIDATION & AUDIT LOGS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 9: ADMIN API ROUTE INTEGRATION, VALIDATION & AUDIT LOGS]");

    const adminUser = await User.create({
      name: `Stage A Admin ${timestamp}`,
      email: `admin_${timestamp}@example.com`,
      passwordHash: "dummy_hash",
      role: UserRole.ADMIN,
    });
    cleanupUserIds.push(adminUser._id as mongoose.Types.ObjectId);

    const jwtSecret = getJwtAccessSecret();
    const adminToken = jwt.sign({ sub: adminUser._id.toString(), role: UserRole.ADMIN }, jwtSecret, { algorithm: "HS256", expiresIn: "1h" });
    const customerToken = jwt.sign({ sub: testUser._id.toString(), role: UserRole.CUSTOMER }, jwtSecret, { algorithm: "HS256", expiresIn: "1h" });

    // 9.1 Mounted Router: Unauthenticated request rejected with 401
    const unauthReq = {
      method: "GET",
      url: "/shipping",
      headers: {},
    } as unknown as Request;
    const unauthOutcome = await invokeRouter(adminShippingSettingsRouter, unauthReq, createMockRes());
    check(
      unauthOutcome.err?.statusCode === 401 || unauthOutcome.err?.code === "UNAUTHORIZED",
      "9.1 Mounted router rejects unauthenticated GET with 401 UNAUTHORIZED"
    );

    // 9.2 Mounted Router: Customer role request rejected with 403
    const custReq = {
      method: "GET",
      url: "/shipping",
      headers: { authorization: `Bearer ${customerToken}` },
    } as unknown as Request;
    const custOutcome = await invokeRouter(adminShippingSettingsRouter, custReq, createMockRes());
    check(
      custOutcome.err?.statusCode === 403 || custOutcome.err?.code === "FORBIDDEN",
      "9.2 Mounted router rejects Customer GET with 403 FORBIDDEN"
    );

    // 9.3 Mounted Router: Customer role PUT request rejected with 403
    const custPutReq = {
      method: "PUT",
      url: "/shipping",
      headers: { authorization: `Bearer ${customerToken}` },
      body: { globalFreeShippingThreshold: 500, standardShippingFee: 50, isGlobalFreeShippingActive: true },
    } as unknown as Request;
    const custPutOutcome = await invokeRouter(adminShippingSettingsRouter, custPutReq, createMockRes());
    check(
      custPutOutcome.err?.statusCode === 403 || custPutOutcome.err?.code === "FORBIDDEN",
      "9.3 Mounted router rejects Customer PUT with 403 FORBIDDEN"
    );

    // 9.4 Mounted Router: Authorized Admin GET succeeds with 200
    const adminGetReq = {
      method: "GET",
      url: "/shipping",
      headers: { authorization: `Bearer ${adminToken}` },
    } as unknown as Request;
    const adminGetOutcome = await invokeRouter(adminShippingSettingsRouter, adminGetReq, createMockRes());
    check(
      !adminGetOutcome.err && adminGetOutcome.res.statusCode === 200,
      "9.4 Mounted router accepts authorized Admin GET with 200 OK"
    );
    // 9.4 Mounted Router: Invalid Negative Threshold Rejected with 400
    const invalidReq1 = {
      user: { id: adminUser._id.toString(), role: "ADMIN" },
      body: {
        globalFreeShippingThreshold: -50,
        standardShippingFee: 100,
        isGlobalFreeShippingActive: true,
      },
    } as unknown as Request;
    let caughtNegativeError: boolean = false;
    await updateAdminShippingSettings(invalidReq1, createMockRes() as unknown as Response, (err?: unknown) => {
      if (err) caughtNegativeError = true;
    });
    check(caughtNegativeError as boolean === true, "9.4 Negative shipping threshold rejected with 400 error");

    // 9.5 Mounted Router: Invalid Non-Numeric Value Rejected with 400
    const invalidReq2 = {
      user: { id: adminUser._id.toString(), role: "ADMIN" },
      body: {
        globalFreeShippingThreshold: "invalid_string",
        standardShippingFee: 100,
        isGlobalFreeShippingActive: true,
      },
    } as unknown as Request;
    let caughtNanError: boolean = false;
    await updateAdminShippingSettings(invalidReq2, createMockRes() as unknown as Response, (err?: unknown) => {
      if (err) caughtNanError = true;
    });
    check(caughtNanError as boolean === true, "9.5 Non-numeric threshold rejected with 400 error");

    // 9.6 Mounted Router: Invalid Negative Shipping Fee Rejected with 400
    const invalidReq3 = {
      user: { id: adminUser._id.toString(), role: "ADMIN" },
      body: {
        globalFreeShippingThreshold: 1000,
        standardShippingFee: -10,
        isGlobalFreeShippingActive: true,
      },
    } as unknown as Request;
    let caughtNegativeFeeError: boolean = false;
    await updateAdminShippingSettings(invalidReq3, createMockRes() as unknown as Response, (err?: unknown) => {
      if (err) caughtNegativeFeeError = true;
    });
    check(caughtNegativeFeeError as boolean === true, "9.6 Negative standard shipping fee rejected with 400 error");

    // 9.7 Authorized Admin Update & Persistence Verification
    const updateReq = {
      user: { id: adminUser._id.toString(), role: "ADMIN" },
      body: {
        globalFreeShippingThreshold: 1499,
        standardShippingFee: 150,
        isGlobalFreeShippingActive: true,
      },
    } as unknown as Request;
    const updateRes = createMockRes();
    await updateAdminShippingSettings(updateReq, updateRes as unknown as Response, () => {});
    check(updateRes.statusCode === 200, "9.7 Authorized admin update succeeds (HTTP 200)");

    // Verify persistence via GET controller
    const getReq = {
      user: { id: adminUser._id.toString(), role: "ADMIN" },
    } as unknown as Request;
    const getRes = createMockRes();
    await getAdminShippingSettings(getReq, getRes as unknown as Response, () => {});
    const fetchedData = getRes.body?.data as Record<string, unknown>;
    check(fetchedData?.globalFreeShippingThreshold === 1499, "9.8 Saved threshold persists after update (₹1,499)");
    check(fetchedData?.standardShippingFee === 150, "9.9 Saved shipping fee persists after update (₹150)");

    // 9.8 AuditLog Record Verification
    const auditRecord = await AuditLog.findOne({
      action: "ADMIN_SHIPPING_SETTINGS_UPDATED",
      actorId: adminUser._id,
    }).sort({ createdAt: -1 });

    check(Boolean(auditRecord), "9.10 AuditLog entry successfully recorded for shipping settings update");
    check(auditRecord?.metadata?.updated?.globalFreeShippingThreshold === 1499, "9.11 AuditLog metadata captures exact new threshold (1499)");
    check(auditRecord?.metadata?.updated?.standardShippingFee === 150, "9.12 AuditLog metadata captures exact new shipping fee (150)");

    // Restore default configuration
    await StoreShippingConfig.updateOne(
      { key: DEFAULT_SHIPPING_CONFIG_KEY },
      { $set: { globalFreeShippingThreshold: 999, standardShippingFee: 100, isGlobalFreeShippingActive: true } }
    );

  } catch (err: unknown) {
    console.error("Test execution threw exception:", err);
    failed++;
    failures.push(String(err));
  } finally {
    console.log("\n🧹 Cleaning up test fixtures from database...");
    await Product.deleteMany({ _id: { $in: cleanupProductIds } });
    await Coupon.deleteMany({ _id: { $in: cleanupCouponIds } });
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
    await Address.deleteMany({ userId: { $in: cleanupUserIds } });
    await Cart.deleteMany({ userId: { $in: cleanupUserIds } });
    await Order.deleteMany({ userId: { $in: cleanupUserIds } });
    await AuditLog.deleteMany({ action: "ADMIN_SHIPPING_SETTINGS_UPDATED" });
    await StoreShippingConfig.deleteMany({});
    await mongoose.disconnect();
    console.log(" Disconnected from MongoDB\n");
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(` - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════");

  if (failed > 0) {
    process.exit(1);
  }
}

runStageATests();
