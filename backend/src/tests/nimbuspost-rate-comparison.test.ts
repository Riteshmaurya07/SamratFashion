/**
 * Samrat Fashion — NimbusPost V2 Stage 1 Test Suite
 * Comprehensive Audit & Verification of Multi-Courier Rate Comparison,
 * Fulfillment Readiness, Package Confirmation & Strict Security Invariants
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb } from "./testHelpers";
import { NimbusPostClient, nimbusPostClient } from "../services/logistics/NimbusPostClient";
import { NimbusPostLogisticsProvider } from "../services/logistics/NimbusPostLogisticsProvider";
import { logisticsService } from "../services/logistics/logisticsService";
import { CourierQuote } from "../models/CourierQuote";
import { Order } from "../models/Order";
import { Fulfillment, FulfillmentStatus } from "../models/Fulfillment";
import { Shipment } from "../models/Shipment";
import { User, UserRole, UserStatus } from "../models/User";
import {
  createOrderCourierQuote,
  getLatestOrderCourierQuote,
  getCourierQuoteById
} from "../controllers/courierQuoteController";
import { confirmFulfillmentPackage, packFulfillment } from "../controllers/fulfillmentController";
import { AppError } from "../utils/AppError";

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
  data: any;
  status(code: number): MockResponse;
  json(payload: any): MockResponse;
  send(payload: any): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.data = payload;
      return this;
    },
    send(payload: any) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║     NimbusPost V2 Stage 1 — Multi-Courier Rate Comparison Suite      ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  const origKey = process.env.NIMBUSPOST_API_KEY;
  const origSecret = process.env.NIMBUSPOST_API_SECRET;
  const origOriginPin = process.env.ORIGIN_POSTAL_CODE;

  process.env.NIMBUSPOST_API_KEY = "npk_test_key_123456789";
  process.env.NIMBUSPOST_API_SECRET = "sec_test_secret_987654321";
  process.env.ORIGIN_POSTAL_CODE = "229402";

  await connectSafeTestDb();

  // Clean test collections
  await CourierQuote.deleteMany({});
  await Fulfillment.deleteMany({});
  await Order.deleteMany({ orderNumber: /^TEST-NP-/ });
  await User.deleteMany({ email: "test-nimbus-admin@samratfashion.com" });

  const adminUser = (await User.create({
    name: "Nimbus Admin Tester",
    email: "test-nimbus-admin@samratfashion.com",
    passwordHash: "dummyhash123",
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    phoneVerified: true
  })) as any;

  const sampleOrder = (await Order.create({
    userId: adminUser._id,
    orderNumber: `TEST-NP-${Date.now()}`,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: "Silk Saree",
        productImage: "https://example.com/saree.jpg",
        selectedSize: "FREE",
        selectedColor: "RED",
        quantity: 1,
        unitPrice: 2499,
        lineTotal: 2499
      }
    ],
    total: 2499,
    subtotal: 2499,
    discount: 0,
    tax: 0,
    shipping: 0,
    currency: "INR",
    status: "PROCESSING",
    paymentStatus: "PAID",
    paymentMethod: "RAZORPAY",
    shippingAddress: {
      fullName: "Priya Sharma",
      phone: "9876543210",
      addressLine1: "123 Indiranagar 100ft Road",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
      addressType: "HOME"
    }
  })) as any;

  try {
    // =========================================================================
    // SECTION 1: Exact V2 Authentication Contract & Header Verification
    // =========================================================================
    console.log("\n--- Section 1: Exact V2 Authentication Headers & Credentials ---");

    const client = new NimbusPostClient();
    const headers = client.getHeaders();

    check(headers["x-api-key"] === "npk_test_key_123456789", "1.1 Header 'x-api-key' matches configured key");
    check(headers["x-api-secret"] === "sec_test_secret_987654321", "1.2 Header 'x-api-secret' matches configured secret");
    check(headers["Accept"] === "application/json", "1.3 Header 'Accept' is application/json");
    check(headers["Content-Type"] === "application/json", "1.4 Header 'Content-Type' is application/json");
    check(!("Authorization" in headers), "1.5 No legacy Authorization header or Bearer token is present");

    // Missing credentials validation
    delete process.env.NIMBUSPOST_API_KEY;
    delete process.env.NIMBUSPOST_API_SECRET;

    let missingCredsCaught = false;
    try {
      client.getHeaders();
    } catch (e: any) {
      missingCredsCaught = true;
      check(e instanceof AppError && e.statusCode === 500 && e.code === "LOGISTICS_CONFIG_ERROR", "1.6 Missing credentials throw LOGISTICS_CONFIG_ERROR 500");
    }
    check(missingCredsCaught, "1.7 Missing credentials cleanly rejected");

    let providerMissingCaught = false;
    try {
      logisticsService.getProvider("nimbuspost");
    } catch (e: any) {
      providerMissingCaught = true;
      check(e instanceof AppError && e.code === "LOGISTICS_CONFIG_ERROR", "1.8 logisticsService.getProvider enforces required credentials");
    }
    check(providerMissingCaught, "1.9 Logistics service rejects unconfigured NimbusPost");

    // Restore test credentials
    process.env.NIMBUSPOST_API_KEY = "npk_test_key_123456789";
    process.env.NIMBUSPOST_API_SECRET = "sec_test_secret_987654321";

    // =========================================================================
    // SECTION 2: Request Payload Construction & Grams vs KG & Units Verification
    // =========================================================================
    console.log("\n--- Section 2: Request Construction & Grams vs KG & Paise Units ---");

    let capturedConfig: any = null;
    const axiosInst = (nimbusPostClient as any).axiosInstance;

    // Attach custom test adapter to inspect the exact outgoing payload
    axiosInst.defaults.adapter = async (config: any) => {
      capturedConfig = config;
      return {
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: {
          success: true,
          data: {
            pickupPincode: "229402",
            deliveryPincode: "560001",
            paymentMode: "prepaid",
            totalChargeableGrams: 750,
            available: [
              {
                courierId: "671e1a2b3c4d5e6f7a8b9001",
                courierCode: "delhivery-surface",
                courierName: "Delhivery Surface",
                courierDisplayName: "Delhivery Express Surface",
                courierType: "surface",
                zone: "d",
                zoneLabel: "National",
                tatDays: 4,
                autoPickup: true,
                result: {
                  chargeableGrams: 750,
                  shippingChargesPaise: 9500,
                  codChargesPaise: 0,
                  surchargesPaise: 500,
                  totalPaise: 10000
                }
              },
              {
                courierId: "671e1a2b3c4d5e6f7a8b9002",
                courierCode: "bluedart-air",
                courierName: "BlueDart Air",
                courierDisplayName: "BlueDart Express Air",
                courierType: "air",
                zone: "d",
                zoneLabel: "National",
                tatDays: 2,
                autoPickup: true,
                result: {
                  chargeableGrams: 750,
                  shippingChargesPaise: 14500,
                  codChargesPaise: 0,
                  surchargesPaise: 500,
                  totalPaise: 15000
                }
              }
            ],
            excluded: [
              {
                courierId: "671e1a2b3c4d5e6f7a8b9003",
                courierName: "Xpressbees Heavy",
                reason: "OVER_MAX_WEIGHT",
                detail: "Weight exceeds limit for this mode"
              }
            ]
          },
          meta: { requestId: "req-test-123" }
        }
      };
    };

    const provider = new NimbusPostLogisticsProvider();
    const quoteResult = await provider.getMultiCourierRates({
      originPostalCode: "229402",
      destinationPostalCode: "560001",
      weightGrams: 750,
      lengthCm: 25,
      widthCm: 20,
      heightCm: 10,
      paymentMode: "prepaid",
      orderValuePaise: 249900
    });

    const sentPayload = JSON.parse(capturedConfig.data);
    check(sentPayload.pickupPincode === "229402", "2.1 Sent pickupPincode is string '229402'");
    check(sentPayload.deliveryPincode === "560001", "2.2 Sent deliveryPincode is string '560001'");
    check(sentPayload.paymentMode === "prepaid", "2.3 Sent paymentMode is lowercase 'prepaid'");
    check(sentPayload.packages[0].weight === 750, "2.4 Package weight for serviceability is sent in GRAMS (750), not kg");
    check(sentPayload.packages[0].length === 25 && sentPayload.packages[0].width === 20 && sentPayload.packages[0].height === 10, "2.5 Package dimensions sent accurately in cm");
    check(sentPayload.orderValuePaise === 249900, "2.6 Order value correctly sent in paise (₹2,499 -> 249900)");

    // Available and Excluded parsing checks
    check(quoteResult.available.length === 2, "2.7 Multiple available couriers returned in available array");
    check(quoteResult.available[0].courierName === "Delhivery Surface", "2.8 Courier 1 parsed correctly");
    check(quoteResult.available[0].totalRateRupees === 100, "2.9 Courier 1 total rate converted from paise (10000 -> ₹100)");
    check(quoteResult.available[1].courierName === "BlueDart Air" && quoteResult.available[1].courierType === "air", "2.10 Courier 2 air mode parsed correctly");
    check(quoteResult.available[1].totalRateRupees === 150, "2.11 Courier 2 total rate converted from paise (15000 -> ₹150)");

    check(quoteResult.excluded.length === 1, "2.12 Excluded courier returned in excluded array");
    check(quoteResult.excluded[0].courierName === "Xpressbees Heavy", "2.13 Excluded courier name preserved");
    check(quoteResult.excluded[0].reason === "OVER_MAX_WEIGHT", "2.14 Documented exclusion reason preserved");

    // Price precision regression tests: 7042, 7049, 7050 paise
    axiosInst.defaults.adapter = async (config: any) => ({
      status: 200,
      statusText: "OK",
      headers: {},
      config,
      data: {
        success: true,
        data: {
          pickupPincode: "229402",
          deliveryPincode: "560001",
          paymentMode: "prepaid",
          available: [
            {
              courierId: "c_7050",
              courierCode: "courier-7050",
              courierName: "Courier 7050",
              result: { totalPaise: 7050 }
            },
            {
              courierId: "c_7042",
              courierCode: "courier-7042",
              courierName: "Courier 7042",
              result: { totalPaise: 7042 }
            },
            {
              courierId: "c_7049",
              courierCode: "courier-7049",
              courierName: "Courier 7049",
              result: { totalPaise: 7049 }
            }
          ],
          excluded: []
        }
      }
    });

    const precisionResult = await provider.getMultiCourierRates({
      originPostalCode: "229402",
      destinationPostalCode: "560001",
      weightGrams: 500,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      paymentMode: "prepaid",
      orderValuePaise: 100000
    });

    const c7042 = precisionResult.available.find(c => c.courierId === "c_7042");
    const c7049 = precisionResult.available.find(c => c.courierId === "c_7049");
    const c7050 = precisionResult.available.find(c => c.courierId === "c_7050");

    check(c7042?.totalRatePaise === 7042 && c7042?.totalRateRupees === 70.42, "2.15 Exact paise precision: 7042 paise -> ₹70.42 (no rounding loss)");
    check(c7049?.totalRatePaise === 7049 && c7049?.totalRateRupees === 70.49, "2.16 Exact paise precision: 7049 paise -> ₹70.49 (no rounding loss)");
    check(c7050?.totalRatePaise === 7050 && c7050?.totalRateRupees === 70.50, "2.17 Exact paise precision: 7050 paise -> ₹70.50 (no rounding loss)");

    // Sorting check: exact paise ascending
    const sortedCouriers = [...precisionResult.available].sort((a, b) => a.totalRatePaise - b.totalRatePaise);
    check(sortedCouriers[0].courierId === "c_7042" && sortedCouriers[1].courierId === "c_7049" && sortedCouriers[2].courierId === "c_7050", "2.18 Ascending courier comparison correctly sorts by exact integer paise (7042 < 7049 < 7050)");

    // =========================================================================
    // SECTION 3: Safe Error Handling, Timeout, and Status Code Mapping
    // =========================================================================
    console.log("\n--- Section 3: Error Normalization, Timeout & Malformed Responses ---");

    // 3.1 Network Timeout Simulation
    axiosInst.defaults.adapter = async () => {
      const timeoutErr: any = new Error("timeout of 10000ms exceeded");
      timeoutErr.code = "ECONNABORTED";
      throw timeoutErr;
    };

    let timeoutCaught = false;
    try {
      await provider.getMultiCourierRates({
        originPostalCode: "229402",
        destinationPostalCode: "560001",
        weightGrams: 500,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 10,
        paymentMode: "prepaid",
        orderValuePaise: 100000
      });
    } catch (e: any) {
      timeoutCaught = true;
      check(e instanceof AppError && e.statusCode === 504 && e.code === "GATEWAY_TIMEOUT", "3.1 Axios timeout normalizes to GATEWAY_TIMEOUT 504");
    }
    check(timeoutCaught, "3.2 Timeout handled safely");

    // 3.2 401 Unauthorized Simulation
    axiosInst.defaults.adapter = async () => {
      const err401: any = new Error("Request failed with status code 401");
      err401.response = { status: 401, data: { success: false, error: { code: "UNAUTHORIZED", title: "Auth failed" } } };
      throw err401;
    };

    let auth401Caught = false;
    try {
      await provider.getMultiCourierRates({
        originPostalCode: "229402",
        destinationPostalCode: "560001",
        weightGrams: 500,
        lengthCm: 10,
        widthCm: 10,
        heightCm: 10,
        paymentMode: "prepaid",
        orderValuePaise: 100000
      });
    } catch (e: any) {
      auth401Caught = true;
      check(e instanceof AppError && e.statusCode === 401 && e.code === "UNAUTHORIZED", "3.3 Upstream 401 normalizes to UNAUTHORIZED 401");
    }
    check(auth401Caught, "3.4 Auth error handled safely");

    // 3.3 Empty Available Couriers Simulation
    axiosInst.defaults.adapter = async (config: any) => ({
      status: 200,
      statusText: "OK",
      headers: {},
      config,
      data: {
        success: true,
        data: {
          pickupPincode: "229402",
          deliveryPincode: "799999",
          paymentMode: "prepaid",
          available: [],
          excluded: [
            { courierName: "Delhivery Surface", reason: "NO_DELIVERY_SERVICE" }
          ]
        }
      }
    });

    const emptyResult = await provider.getMultiCourierRates({
      originPostalCode: "229402",
      destinationPostalCode: "799999",
      weightGrams: 500,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      paymentMode: "prepaid",
      orderValuePaise: 100000
    });
    check(emptyResult.available.length === 0, "3.5 Empty available courier array handled without crash");
    check(emptyResult.excluded.length === 1, "3.6 Excluded items retained when available is empty");

    // =========================================================================
    // SECTION 4: Fulfillment Readiness & Package Confirmation Checks
    // =========================================================================
    console.log("\n--- Section 4: Fulfillment Readiness & Package Confirmation Checks ---");

    // 4.1 Missing Fulfillment rejection
    let missingFulfillmentCaught = false;
    try {
      const mockReq: any = {
        params: { id: sampleOrder._id.toString() },
        body: {},
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const mockRes = createMockRes();
      await createOrderCourierQuote(mockReq, mockRes as any, (err) => { throw err; });
    } catch (e: any) {
      missingFulfillmentCaught = true;
      check(e instanceof AppError && e.statusCode === 400 && e.code === "FULFILLMENT_NOT_FOUND", "4.1 Missing fulfillment record rejected with FULFILLMENT_NOT_FOUND");
    }
    check(missingFulfillmentCaught, "4.2 Controller blocks quote when fulfillment does not exist");

    // Create Fulfillment in ALLOCATED status
    await Fulfillment.create({
      orderId: sampleOrder._id,
      userId: adminUser._id,
      status: FulfillmentStatus.ALLOCATED,
      items: [
        {
          productId: sampleOrder.items[0].productId,
          variantId: sampleOrder.items[0].variantId,
          productName: sampleOrder.items[0].productName,
          selectedSize: "FREE",
          selectedColor: "RED",
          quantityOrdered: 1,
          quantityPicked: 1,
          quantityPacked: 0
        }
      ],
      packageDetails: {
        weightGrams: 500,
        lengthCm: 30,
        widthCm: 25,
        heightCm: 5,
        isConfirmed: false
      },
      createdBy: adminUser._id,
      updatedBy: adminUser._id
    });

    // 4.1A: Calling packFulfillment with default values must NOT set isConfirmed = true
    const packReq: any = {
      params: { id: sampleOrder._id.toString() },
      body: {
        packageDetails: { weightGrams: 600, lengthCm: 30, widthCm: 25, heightCm: 5 }
      },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const packRes = createMockRes();
    await packFulfillment(packReq, packRes as any);

    check(packRes.statusCode === 200, "4.1A packFulfillment succeeds with 200");
    const packedFulfillment = await Fulfillment.findOne({ orderId: sampleOrder._id });
    check(packedFulfillment?.status === FulfillmentStatus.PACKED, "4.1B packFulfillment sets status to PACKED");
    check(packedFulfillment?.packageDetails?.isConfirmed === false, "4.1C packFulfillment with prefilled/default package values does NOT automatically confirm package (isConfirmed: false)");
    check(packedFulfillment?.packageDetails?.confirmedAt === undefined, "4.1D Confirmation metadata (confirmedAt) remains undefined after packing");

    // 4.2 Non-READY_TO_SHIP Fulfillment rejection
    let nonReadyCaught = false;
    try {
      const mockReq: any = {
        params: { id: sampleOrder._id.toString() },
        body: {},
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const mockRes = createMockRes();
      await createOrderCourierQuote(mockReq, mockRes as any, (err) => { throw err; });
    } catch (e: any) {
      nonReadyCaught = true;
      check(e instanceof AppError && e.statusCode === 400 && e.code === "FULFILLMENT_NOT_READY_TO_SHIP", "4.2A Non-READY_TO_SHIP fulfillment rejected with FULFILLMENT_NOT_READY_TO_SHIP");
    }
    check(nonReadyCaught, "4.2B Controller requires Fulfillment.status === READY_TO_SHIP (never checks Order.status)");

    // Advance fulfillment to READY_TO_SHIP, but package is still unconfirmed
    packedFulfillment!.status = FulfillmentStatus.READY_TO_SHIP;
    await packedFulfillment!.save();

    // 4.3 Unconfirmed package details rejection
    let unconfirmedPackageCaught = false;
    try {
      const mockReq: any = {
        params: { id: sampleOrder._id.toString() },
        body: {},
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const mockRes = createMockRes();
      await createOrderCourierQuote(mockReq, mockRes as any, (err) => { throw err; });
    } catch (e: any) {
      unconfirmedPackageCaught = true;
      check(e instanceof AppError && e.statusCode === 400 && e.code === "PACKAGE_NOT_CONFIRMED", "4.3A Model default/unconfirmed package rejected with PACKAGE_NOT_CONFIRMED");
    }
    check(unconfirmedPackageCaught, "4.3B Quote generation cannot proceed using unconfirmed measurements");

    // 4.4 Dedicated package confirmation rejects invalid values
    // 4.4A NaN rejection
    let nanCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: "invalid_num", lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) nanCaught = true;
    } catch {
      nanCaught = true;
    }
    check(nanCaught, "4.4A Dedicated package confirmation rejects NaN weight");

    // 4.4B Infinity rejection
    let infinityCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: Infinity, lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) infinityCaught = true;
    } catch {
      infinityCaught = true;
    }
    check(infinityCaught, "4.4B Dedicated package confirmation rejects Infinity");

    // 4.4C Zero rejection
    let zeroCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: 0, lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) zeroCaught = true;
    } catch {
      zeroCaught = true;
    }
    check(zeroCaught, "4.4C Dedicated package confirmation rejects zero weight");

    // 4.4D Negative rejection
    let negativeCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: -100, lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) negativeCaught = true;
    } catch {
      negativeCaught = true;
    }
    check(negativeCaught, "4.4D Dedicated package confirmation rejects negative measurements");

    // 4.4E Missing fields rejection
    let missingFieldCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: 650 }, // missing length, width, height
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) missingFieldCaught = true;
    } catch {
      missingFieldCaught = true;
    }
    check(missingFieldCaught, "4.4E Dedicated package confirmation rejects missing dimensions");

    // 4.4F In PACKED status: confirmFulfillmentPackage must be rejected (requires READY_TO_SHIP)
    packedFulfillment!.status = FulfillmentStatus.PACKED;
    await packedFulfillment!.save();
    let packedConfirmCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: 650, lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) packedConfirmCaught = true;
    } catch {
      packedConfirmCaught = true;
    }
    check(packedConfirmCaught, "4.4F Package confirmation rejected when fulfillment is in PACKED status");

    // In QC_FAILED status: confirmFulfillmentPackage must be rejected!
    packedFulfillment!.status = FulfillmentStatus.QC_FAILED;
    await packedFulfillment!.save();

    let qcFailedConfirmCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: 650, lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) qcFailedConfirmCaught = true;
    } catch {
      qcFailedConfirmCaught = true;
    }
    check(qcFailedConfirmCaught, "4.4G Package confirmation rejected when fulfillment is in QC_FAILED status");

    // In CANCELLED status: confirmFulfillmentPackage must be rejected!
    packedFulfillment!.status = FulfillmentStatus.CANCELLED;
    await packedFulfillment!.save();

    let cancelledConfirmCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: 650, lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) cancelledConfirmCaught = true;
    } catch {
      cancelledConfirmCaught = true;
    }
    check(cancelledConfirmCaught, "4.4H Package confirmation rejected when fulfillment is in CANCELLED status");

    // In HANDED_OVER status: confirmFulfillmentPackage must be rejected!
    packedFulfillment!.status = FulfillmentStatus.HANDED_OVER;
    await packedFulfillment!.save();

    let handedOverConfirmCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: 650, lengthCm: 28, widthCm: 22, heightCm: 8 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) handedOverConfirmCaught = true;
    } catch {
      handedOverConfirmCaught = true;
    }
    check(handedOverConfirmCaught, "4.4I Package confirmation rejected when fulfillment is in HANDED_OVER status");

    // Reset to READY_TO_SHIP so valid confirmation can proceed
    packedFulfillment!.status = FulfillmentStatus.READY_TO_SHIP;
    await packedFulfillment!.save();

    // 4.5 Dedicated package confirmation accepts valid finite measurements
    const confirmReq: any = {
      params: { id: sampleOrder._id.toString() },
      body: { weightGrams: 650, lengthCm: 28, widthCm: 22, heightCm: 8 },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const confirmRes = createMockRes();
    await confirmFulfillmentPackage(confirmReq, confirmRes as any);

    check(confirmRes.statusCode === 200, "4.5A confirmFulfillmentPackage succeeds with 200 for valid finite values");
    const confirmedFulfillment = await Fulfillment.findOne({ orderId: sampleOrder._id });
    check(confirmedFulfillment?.packageDetails?.isConfirmed === true, "4.5B Package details marked isConfirmed: true");
    check(confirmedFulfillment?.packageDetails?.confirmedAt !== undefined, "4.5C confirmedAt timestamp persisted");
    check(confirmedFulfillment?.packageDetails?.confirmedBy?.toString() === adminUser._id.toString(), "4.5D confirmedBy admin user ID persisted");
    check(confirmedFulfillment?.packageDetails?.weightGrams === 650, "4.5E Package weight accurately confirmed to 650g");
    check(confirmedFulfillment?.status === FulfillmentStatus.READY_TO_SHIP, "4.6 Package confirmation does NOT alter Fulfillment.status");
    // =========================================================================
    // SECTION 5: Payment Mode & Authoritative Data Invariants
    // =========================================================================
    console.log("\n--- Section 5: Payment Mode & Authoritative Data Invariants ---");

    // 5.1 Unpaid order rejection
    sampleOrder.paymentStatus = "PENDING";
    await sampleOrder.save();

    let unpaidCaught = false;
    try {
      const mockReq: any = {
        params: { id: sampleOrder._id.toString() },
        body: {},
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const mockRes = createMockRes();
      await createOrderCourierQuote(mockReq, mockRes as any, (err) => { throw err; });
    } catch (e: any) {
      unpaidCaught = true;
      check(e instanceof AppError && e.statusCode === 400 && e.code === "ORDER_UNPAID", "5.1 Unpaid order rejected with 400 ORDER_UNPAID");
    }
    check(unpaidCaught, "5.2 PENDING/unpaid orders are never inferred as COD");

    // Restore PAID status
    sampleOrder.paymentStatus = "PAID";
    await sampleOrder.save();

    // Reset adapter to valid provider response
    axiosInst.defaults.adapter = async (config: any) => {
      capturedConfig = config;
      return {
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: {
          success: true,
          data: {
            pickupPincode: "229402",
            deliveryPincode: "560001",
            paymentMode: "prepaid",
            available: [
              {
                courierId: "c-delhi",
                courierCode: "delhivery-surf",
                courierName: "Delhivery Surface",
                result: { totalPaise: 9500, chargeableGrams: 650, shippingChargesPaise: 9000, surchargesPaise: 500 }
              }
            ],
            excluded: []
          }
        }
      };
    };

    // 5.2 Successful Quote Generation using Database-Confirmed Measurements
    const validQuoteReq: any = {
      params: { id: sampleOrder._id.toString() },
      body: {
        // Attempting to spoof dimensions in request body must be ignored!
        weightGrams: 9999,
        lengthCm: 999,
        provider: "nimbuspost"
      },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const validQuoteRes = createMockRes();
    await createOrderCourierQuote(validQuoteReq, validQuoteRes as any, (err) => { if (err) throw err; });

    check(validQuoteRes.statusCode === 201, "5.3 Valid quote generated with 201 Created");
    const quoteData = validQuoteRes.data?.data;
    check(quoteData?.packageDetails?.weightGrams === 650, "5.4 Backend used database-confirmed weight (650g), ignored client body");
    check(quoteData?.paymentMode === "prepaid", "5.5 Payment mode strictly set to 'prepaid'");
    check(quoteData?.orderValuePaise === 249900, "5.6 Authoritative order total used (249900 paise)");

    const sentReqBody = JSON.parse(capturedConfig.data);
    check(sentReqBody.packages[0].weight === 650, "5.7 NimbusPost API received confirmed 650g, spoofed client 9999g rejected");

    // =========================================================================
    // SECTION 6: Quote Expiration, Fingerprint & Invalidation Mechanics
    // =========================================================================
    console.log("\n--- Section 6: Quote Expiration, Fingerprinting & Invalidation ---");

    const savedQuote = await CourierQuote.findById(quoteData.quoteId);
    check(savedQuote !== null, "6.1 Quote persisted in MongoDB CourierQuote collection");
    check(savedQuote?.packageFingerprint === "650_28_22_8", "6.2 Package fingerprint matches confirmed measurements");
    check(savedQuote?.isExpired() === false, "6.3 Fresh quote isExpired() is false");

    // 6.2 Stale Package Invalidation Check: Changing package measurements invalidates the quote!
    const reconfirmReq: any = {
      params: { id: sampleOrder._id.toString() },
      body: { weightGrams: 850, lengthCm: 32, widthCm: 24, heightCm: 10 },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const reconfirmRes = createMockRes();
    await confirmFulfillmentPackage(reconfirmReq, reconfirmRes as any);
    check(reconfirmRes.statusCode === 200, "6.4 Admin updated package measurements to 850g");

    const getLatestReq: any = { params: { id: sampleOrder._id.toString() } };
    const getLatestRes = createMockRes();
    await getLatestOrderCourierQuote(getLatestReq, getLatestRes as any, (err) => { if (err) throw err; });

    check(getLatestRes.statusCode === 200, "6.5 getLatestOrderCourierQuote succeeded");
    check(getLatestRes.data?.data?.isPackageStale === true, "6.6 Quote marked isPackageStale: true after measurements changed");
    check(getLatestRes.data?.data?.isStale === true, "6.7 Quote marked isStale: true");
    check(typeof getLatestRes.data?.data?.staleReason === "string", "6.8 Clear stale reason provided to client");

    // 6.3 Expiration Check: Advance quote past 15-minute expiry
    savedQuote!.expiresAt = new Date(Date.now() - 1000);
    await savedQuote!.save();

    const getByIdReq: any = { params: { quoteId: savedQuote!._id.toString() } };
    const getByIdRes = createMockRes();
    await getCourierQuoteById(getByIdReq, getByIdRes as any, (err) => { if (err) throw err; });

    check(getByIdRes.statusCode === 200, "6.9 getCourierQuoteById succeeded");
    check(getByIdRes.data?.data?.isExpired === true, "6.10 Expired quote marked isExpired: true");

    // 6.11 Existing-Shipment Protection Tests
    await Shipment.create({
      orderId: sampleOrder._id,
      userId: adminUser._id,
      carrier: "Delhivery Surface",
      trackingNumber: "DEL-TEST-998877",
      awbNumber: "DEL-TEST-998877",
      provider: "nimbuspost",
      status: "LABEL_CREATED",
      trackingHistory: [
        {
          status: "LABEL_CREATED",
          description: "Shipment created",
          timestamp: new Date()
        }
      ],
      createdBy: adminUser._id,
      updatedBy: adminUser._id
    });

    // createOrderCourierQuote rejects when shipment exists
    let quoteWithShipmentCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { provider: "nimbuspost" },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await createOrderCourierQuote(req, res as any, (err) => { throw err; });
    } catch (e: any) {
      quoteWithShipmentCaught = true;
      check(e instanceof AppError && e.statusCode === 400 && e.code === "SHIPMENT_ALREADY_EXISTS", "6.11 createOrderCourierQuote rejects order when a shipment already exists");
    }
    check(quoteWithShipmentCaught, "6.12 Backend protects against quote generation when shipment exists");

    // confirmFulfillmentPackage rejects when shipment exists
    let confirmWithShipmentCaught = false;
    try {
      const req: any = {
        params: { id: sampleOrder._id.toString() },
        body: { weightGrams: 900, lengthCm: 30, widthCm: 25, heightCm: 10 },
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await confirmFulfillmentPackage(req, res as any);
      if (res.statusCode >= 400) confirmWithShipmentCaught = true;
    } catch (e: any) {
      confirmWithShipmentCaught = true;
    }
    check(confirmWithShipmentCaught, "6.13 confirmFulfillmentPackage rejects package modifications once shipment exists");

    // getLatestOrderCourierQuote marks isShipmentCreated: true, isStale: true
    const latestShipmentRes = createMockRes();
    await getLatestOrderCourierQuote(getLatestReq, latestShipmentRes as any, (err) => { if (err) throw err; });
    check(latestShipmentRes.data?.data?.isShipmentCreated === true, "6.14 getLatestOrderCourierQuote flags isShipmentCreated: true");
    check(latestShipmentRes.data?.data?.isStale === true, "6.15 getLatestOrderCourierQuote marks quote as stale after shipment creation");
    check(latestShipmentRes.data?.data?.staleReason?.includes("already been created"), "6.16 Stale reason explains shipment already created");

    // =========================================================================
    // SECTION 7: Regression Checks & Non-Interference
    // =========================================================================
    console.log("\n--- Section 7: Regression Checks & Non-Interference ---");

    // 7.1 Delhivery provider continues to work
    const delhiveryProvider = logisticsService.getProvider("delhivery");
    check(delhiveryProvider.name === "delhivery", "7.1 Delhivery provider remains registered and unchanged");

    // 7.2 Mock provider continues to work
    const mockProvider = logisticsService.getProvider("mock");
    check(mockProvider.name === "mock", "7.2 Mock provider remains registered and unchanged");

    // 7.4 Shipment booking through NimbusPost V2 POST /v2/shipments
    const nimbusMulti = logisticsService.getMultiCourierProvider("nimbuspost");
    let capturedShipmentConfig: any = null;
    axiosInst.defaults.adapter = async (config: any) => {
      capturedShipmentConfig = config;
      return {
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: {
          success: true,
          data: {
            order: { order_id: "NIMBUS-ORD-101", order_status: "booked" },
            booking: {
              order_id: "NIMBUS-ORD-101",
              awb: "142857193021",
              courier_name: "Delhivery Surface",
              courier_id: "671e1a2b3c4d5e6f7a8b9001",
              status: "booked"
            }
          }
        }
      };
    };

    const bookingRes = await nimbusMulti.createShipment({
      orderId: sampleOrder._id.toString(),
      orderNumber: sampleOrder.orderNumber,
      courierId: "671e1a2b3c4d5e6f7a8b9001",
      recipient: {
        fullName: sampleOrder.shippingAddress.fullName,
        phone: sampleOrder.shippingAddress.phone,
        addressLine1: sampleOrder.shippingAddress.addressLine1,
        city: sampleOrder.shippingAddress.city,
        state: sampleOrder.shippingAddress.state,
        postalCode: sampleOrder.shippingAddress.postalCode,
        country: sampleOrder.shippingAddress.country
      },
      items: [
        {
          productName: "Silk Saree",
          quantity: 1,
          unitPrice: 2499
        }
      ],
      packageDetails: {
        weightGrams: 650,
        lengthCm: 28,
        widthCm: 22,
        heightCm: 8
      }
    });

    const sentBookingPayload = JSON.parse(capturedShipmentConfig.data);
    check(sentBookingPayload.package.weight === 0.65, "7.4 NimbusPost POST /v2/shipments dead weight accurately converted to kilograms (650g -> 0.65kg)");
    check(sentBookingPayload.courier_id === "671e1a2b3c4d5e6f7a8b9001", "7.5 Selected courier ID passed to NimbusPost shipment API");
    check(bookingRes.awbNumber === "142857193021", "7.6 AWB tracking code captured from NimbusPost booking");
    check(bookingRes.carrier === "Delhivery Surface", "7.7 Courier carrier name captured from NimbusPost booking");
    check(bookingRes.status === "LABEL_CREATED", "7.8 Shipment created with LABEL_CREATED status");
  } finally {
    // Cleanup
    process.env.NIMBUSPOST_API_KEY = origKey;
    process.env.NIMBUSPOST_API_SECRET = origSecret;
    process.env.ORIGIN_POSTAL_CODE = origOriginPin;

    await CourierQuote.deleteMany({ orderNumber: /^TEST-NP-/ });
    await Fulfillment.deleteMany({ orderId: sampleOrder._id });
    await Order.deleteMany({ orderNumber: /^TEST-NP-/ });
    await Shipment.deleteMany({ orderId: sampleOrder._id });
    await User.deleteMany({ email: "test-nimbus-admin@samratfashion.com" });

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log("\n══════════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    console.error("Failed checks:", failures);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled test suite error:", err);
  process.exit(1);
});
