/**
 * Samrat Fashion — NimbusPost V2 Reverse Courier Pickup & Return Integration Test Suite
 * Comprehensive Verification of Reverse Serviceability, Booking, Tracking, Status Separation & Refunds
 */

import mongoose from "mongoose";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();
import { connectSafeTestDb } from "./testHelpers";
import { nimbusPostClient } from "../services/logistics/NimbusPostClient";
import { ReturnRequest } from "../models/ReturnRequest";
import { ReverseShipment } from "../models/ReverseShipment";
import { Shipment } from "../models/Shipment";
import { Order } from "../models/Order";
import { Product, ProductStatus } from "../models/Product";
import { User, UserRole, UserStatus } from "../models/User";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import {
  approveReturn,
  getReverseCourierQuotes,
  bookReversePickup,
  manualReturnShipping,
  getReturnReverseShipment,
  acceptReturn,
  rejectReturnAfterInspection
} from "../controllers/returnController";
import { handleLogisticsWebhook } from "../controllers/logisticsWebhookController";
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
  console.log("║     NimbusPost V2 — Reverse Pickup & Returns Integration Suite       ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝\n");

  const origKey = process.env.NIMBUSPOST_API_KEY;
  const origSecret = process.env.NIMBUSPOST_API_SECRET;
  const origOriginPin = process.env.ORIGIN_POSTAL_CODE;
  process.env.ALLOW_PAYMENT_MOCK = "true";
  process.env.NIMBUSPOST_API_KEY = "npk_test_key_123456789";
  process.env.NIMBUSPOST_API_SECRET = "sec_test_secret_987654321";
  process.env.ORIGIN_POSTAL_CODE = "229402";

  await connectSafeTestDb();

  // Clean test collections
  await ReturnRequest.deleteMany({});
  await ReverseShipment.deleteMany({});
  await Shipment.deleteMany({ awbNumber: /^TEST-/ });
  await Order.deleteMany({ orderNumber: /^TEST-REV-/ });
  await User.deleteMany({ email: "test-reverse-admin@samratfashion.com" });
  await Product.deleteMany({ name: "Test Returnable Kurta" });

  const adminUser = (await User.create({
    name: "Reverse Logistics Admin",
    email: "test-reverse-admin@samratfashion.com",
    passwordHash: "dummyhash123",
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    phoneVerified: true
  })) as any;

  const testProduct = (await Product.create({
    name: "Test Returnable Kurta",
    slug: `test-kurta-${Date.now()}`,
    description: "Premium cotton kurta for return testing",
    basePrice: 1999,
    status: ProductStatus.ACTIVE,
    categoryId: new mongoose.Types.ObjectId(),
    variants: [
      {
        _id: new mongoose.Types.ObjectId(),
        size: "L",
        color: "BLUE",
        additionalPrice: 0,
        stock: 20,
        isAvailable: true,
        sku: "KUR-L-BLU"
      }
    ],
  })) as any;

  const testVariantId = testProduct.variants[0]._id;

  const sampleOrder = (await Order.create({
    userId: adminUser._id,
    orderNumber: `TEST-REV-${Date.now()}`,
    items: [
      {
        productId: testProduct._id,
        variantId: testVariantId,
        productName: testProduct.name,
        productImage: "https://example.com/kurta.jpg",
        selectedSize: "L",
        selectedColor: "BLUE",
        quantity: 1,
        unitPrice: 1999,
        lineTotal: 1999,
        sku: "KUR-L-BLU"
      }
    ],
    total: 1999,
    subtotal: 1999,
    discount: 0,
    tax: 0,
    shipping: 0,
    currency: "INR",
    status: "DELIVERED",
    paymentStatus: "PAID",
    paymentMethod: "RAZORPAY",
    shippingAddress: {
      fullName: "Ananya Roy",
      phone: "9876543210",
      addressLine1: "42 Park Street",
      city: "Kolkata",
      state: "West Bengal",
      postalCode: "700016",
      country: "India",
      addressType: "HOME"
    }
  })) as any;

  const payment = await Payment.create({
    orderId: sampleOrder._id,
    userId: adminUser._id,
    amount: sampleOrder.total,
    currency: "INR",
    status: "CAPTURED",
    provider: "RAZORPAY",
    refundedAmount: 0
  });

  await PaymentAttempt.create({
    paymentId: payment._id,
    orderId: sampleOrder._id,
    razorpayOrderId: `order_mock_${Date.now()}`,
    razorpayPaymentId: `pay_mock_${Date.now()}`,
    amount: sampleOrder.total,
    currency: "INR",
    status: "CAPTURED"
  });

  const returnRequest = (await ReturnRequest.create({
    orderId: sampleOrder._id,
    userId: adminUser._id,
    items: [
      {
        productId: testProduct._id,
        variantId: testVariantId,
        quantity: 1,
        reason: "WRONG_SIZE"
      }
    ],
    status: "REQUESTED",
    customerNote: "Size L is too loose, need size M"
  })) as any;

  const axiosInst = (nimbusPostClient as any).axiosInstance;
  let capturedConfig: any = null;

  try {
    // =========================================================================
    // SECTION 1: Return Approval & Dummy AWB Removal
    // =========================================================================
    console.log("\n--- Section 1: Return Approval Workflow (No Fake AWBs) ---");

    const approveReq: any = {
      params: { id: returnRequest._id.toString() },
      body: { adminNote: "Return approved. Customer can arrange reverse pickup or send directly." },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const approveRes = createMockRes();
    await approveReturn(approveReq, approveRes as any, (err?: any) => { if (err) throw err; });

    check(approveRes.statusCode === 200, "1.1 Return approved successfully with HTTP 200");
    const approvedRet = await ReturnRequest.findById(returnRequest._id);
    check(approvedRet?.status === "APPROVED", "1.2 Return status moved to APPROVED");
    check(approvedRet?.returnAwbNumber === undefined, "1.3 Dummy AWB generator is removed (no fake RET-AWB created)");
    check(approvedRet?.returnCarrier === undefined, "1.4 Fake returnCarrier ('Samrat Reverse Logistics') is removed");

    // =========================================================================
    // SECTION 2: Reverse Rate Quotes (NimbusPost V2 Serviceability)
    // =========================================================================
    console.log("\n--- Section 2: Reverse Courier Rate Queries ---");

    // 2.1 Rejection when return is not APPROVED
    returnRequest.status = "REQUESTED";
    await returnRequest.save();

    let unapprovedQuotesCaught = false;
    try {
      const req: any = {
        params: { id: returnRequest._id.toString() },
        body: {},
        user: { id: adminUser._id.toString(), role: "ADMIN" }
      };
      const res = createMockRes();
      await getReverseCourierQuotes(req, res as any, (err?: any) => { throw err; });
    } catch (e: any) {
      unapprovedQuotesCaught = true;
      check(e instanceof AppError && e.statusCode === 400, "2.1 Reverse quotes rejected for non-APPROVED return request");
    }
    check(unapprovedQuotesCaught, "2.2 Gated to APPROVED status only");

    // Restore APPROVED status
    returnRequest.status = "APPROVED";
    await returnRequest.save();

    // 2.2 Mock reverse serviceability response from NimbusPost
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
            pickupPincode: "700016",
            deliveryPincode: "229402",
            paymentMode: "reverse",
            totalChargeableGrams: 500,
            available: [
              {
                courierId: "6a06d0daea73ccc9fd278960",
                courierCode: "delhivery-reverse-air",
                courierName: "Delhivery Air Reverse",
                courierDisplayName: "Delhivery Express Air Reverse",
                courierType: "air",
                tatDays: 4,
                result: {
                  chargeableGrams: 500,
                  shippingChargesPaise: 15969,
                  totalPaise: 15969
                }
              }
            ],
            excluded: []
          }
        }
      };
    };

    const quoteReq: any = {
      params: { id: returnRequest._id.toString() },
      body: {
        pickupAddress: { postalCode: "700016" },
        packageDetails: { weightGrams: 500, lengthCm: 25, widthCm: 20, heightCm: 10 }
      },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const quoteRes = createMockRes();
    await getReverseCourierQuotes(quoteReq, quoteRes as any, (err?: any) => { if (err) throw err; });

    check(quoteRes.statusCode === 200, "2.3 getReverseCourierQuotes returned 200 OK");
    const quotePayload = JSON.parse(capturedConfig.data);
    check(quotePayload.pickupPincode === "700016", "2.4 Reverse pickup PIN is customer location ('700016')");
    check(quotePayload.deliveryPincode === "229402", "2.5 Reverse delivery PIN is warehouse location ('229402')");
    check(quotePayload.paymentMode === "reverse", "2.6 paymentMode is strictly 'reverse'");
    check(quoteRes.data?.data?.available?.[0]?.courierName === "Delhivery Air Reverse", "2.7 Mapped available reverse courier partner");
    check(quoteRes.data?.data?.available?.[0]?.totalRateRupees === 159.69, "2.8 Exact paise precision preserved for reverse freight (15969 -> ₹159.69)");

    // =========================================================================
    // SECTION 3: Real Reverse Pickup Booking (POST /v2/shipments)
    // =========================================================================
    console.log("\n--- Section 3: Reverse Shipment Booking & Model Persistence ---");

    // Mock NimbusPost reverse shipment creation response
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
            order: {
              order_id: "REV-NIMBUS-ORD-991",
              order_status: "booked"
            },
            booking: {
              order_id: "REV-NIMBUS-ORD-991",
              awb: "142857009988",
              courier_id: "6a06d0daea73ccc9fd278960",
              courier_name: "Delhivery Air Reverse",
              status: "booked",
              label_url: "https://cdn.nimbuspost.com/labels/rev_label_142857009988.pdf"
            }
          }
        }
      };
    };

    const bookReq: any = {
      params: { id: returnRequest._id.toString() },
      body: {
        courierId: "6a06d0daea73ccc9fd278960",
        pickupAddress: {
          fullName: "Ananya Roy",
          phone: "9876543210",
          addressLine1: "42 Park Street, Flat 3B",
          city: "Kolkata",
          state: "West Bengal",
          postalCode: "700016",
          country: "India"
        },
        packageDetails: {
          weightGrams: 500,
          lengthCm: 25,
          widthCm: 20,
          heightCm: 10
        },
        returnReason: "wrong_item",
        returnReasonNote: "Customer requested size replacement"
      },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const bookRes = createMockRes();
    await bookReversePickup(bookReq, bookRes as any, (err?: any) => { if (err) throw err; });

    check(bookRes.statusCode === 201, "3.1 bookReversePickup returns 201 Created");
    const bookingPayload = JSON.parse(capturedConfig.data);
    check(bookingPayload.order_type === "reverse", "3.2 Sents order_type: 'reverse' to NimbusPost V2");
    check(bookingPayload.package.weight === 0.5, "3.3 Dead weight accurately converted to kilograms (500g -> 0.5kg)");
    check(bookingPayload.shipping_address.name === "Ananya Roy", "3.4 Customer pickup address used as pickup location");

    // Verify ReverseShipment record in MongoDB
    const savedReverse = await ReverseShipment.findOne({ returnRequestId: returnRequest._id });
    check(savedReverse !== null, "3.5 ReverseShipment document persisted in MongoDB");
    check(savedReverse?.awbNumber === "142857009988", "3.6 Real reverse AWB number persisted");
    check(savedReverse?.carrier === "Delhivery Air Reverse", "3.7 Courier partner name persisted");
    check(savedReverse?.status === "REVERSE_REQUESTED", "3.8 Initial status is REVERSE_REQUESTED");

    // Verify ReturnRequest was linked
    const updatedReturn = await ReturnRequest.findById(returnRequest._id);
    check(updatedReturn?.returnShippingMethod === "NIMBUSPOST_REVERSE", "3.9 ReturnRequest method updated to NIMBUSPOST_REVERSE");
    check(updatedReturn?.returnAwbNumber === "142857009988", "3.10 ReturnRequest links real AWB number");
    check(updatedReturn?.reverseShipmentId?.toString() === savedReverse!._id.toString(), "3.11 ReturnRequest points to ReverseShipment ID");

    // 3.12 Idempotency test: duplicate booking attempt returns existing without double booking
    const dupRes = createMockRes();
    await bookReversePickup(bookReq, dupRes as any, (err?: any) => { if (err) throw err; });
    check(dupRes.statusCode === 200, "3.12 Duplicate booking request recognized idempotently (returns 200)");
    const totalReverseCount = await ReverseShipment.countDocuments({ returnRequestId: returnRequest._id });
    check(totalReverseCount === 1, "3.13 Exactly one ReverseShipment document exists (no duplicates)");

    // =========================================================================
    // SECTION 4: Invariant Verification: No Premature Refunds or Stock Changes
    // =========================================================================
    console.log("\n--- Section 4: Refund & Inventory Invariants (Strict Protection) ---");

    const orderCheck = await Order.findById(sampleOrder._id);
    check(orderCheck?.paymentStatus === "PAID", "4.1 Booking reverse courier does NOT refund the customer");

    const productCheck = await Product.findById(testProduct._id);
    const variantCheck = productCheck?.variants.find((v: any) => v._id.toString() === testVariantId.toString());
    check(variantCheck?.stock === 20, "4.2 Booking reverse courier does NOT restore inventory (stock remains 20)");

    // =========================================================================
    // SECTION 5: Reverse Tracking Webhook & Status Separation
    console.log("\n--- Section 5: Reverse Tracking Webhook Synchronization ---");

    const webhookSecret = "test_nimbus_reverse_secret_12345";
    process.env.NIMBUSPOST_WEBHOOK_SECRET = webhookSecret;

    // 5.1 Simulate courier in-transit scan
    const inTransitBody = {
      awb: "142857009988",
      status: "in_transit",
      location: "Kolkata Hub",
      description: "Package received at return sorting hub",
      timestamp: new Date().toISOString()
    };
    const inTransitRaw = JSON.stringify(inTransitBody);
    const inTransitSig = `sha256=${crypto.createHmac("sha256", webhookSecret).update(inTransitRaw).digest("hex")}`;

    const inTransitReq: any = {
      headers: {
        "x-nimbus-event": "tracking.updated",
        "x-nimbus-delivery": `deliv_rev_${Date.now()}_1`,
        "x-nimbus-signature": inTransitSig
      },
      body: inTransitBody
    };
    const inTransitRes = createMockRes();
    await handleLogisticsWebhook(inTransitReq, inTransitRes as any, (err?: any) => { if (err) throw err; });

    check(inTransitRes.statusCode === 200, "5.1 In-transit webhook returns 200 OK");
    const inTransitShipment = await ReverseShipment.findOne({ awbNumber: "142857009988" });
    check(inTransitShipment?.status === "IN_TRANSIT", "5.2 ReverseShipment status advanced to IN_TRANSIT");
    check(inTransitShipment?.trackingHistory.length === 2, "5.3 Tracking scan appended to history");

    // 5.2 Simulate courier delivered to warehouse scan
    const deliveredBody = {
      awb: "142857009988",
      status: "delivered",
      location: "Raebareli Warehouse",
      description: "Return package delivered to warehouse",
      timestamp: new Date().toISOString()
    };
    const deliveredRaw = JSON.stringify(deliveredBody);
    const deliveredSig = `sha256=${crypto.createHmac("sha256", webhookSecret).update(deliveredRaw).digest("hex")}`;

    const deliveredReq: any = {
      headers: {
        "x-nimbus-event": "tracking.updated",
        "x-nimbus-delivery": `deliv_rev_${Date.now()}_2`,
        "x-nimbus-signature": deliveredSig
      },
      body: deliveredBody
    };
    const deliveredRes = createMockRes();
    await handleLogisticsWebhook(deliveredReq, deliveredRes as any, (err?: any) => { if (err) throw err; });

    check(deliveredRes.statusCode === 200, "5.4 Delivered webhook returns 200 OK");
    const deliveredShipment = await ReverseShipment.findOne({ awbNumber: "142857009988" });
    check(deliveredShipment?.status === "DELIVERED_TO_WAREHOUSE", "5.5 ReverseShipment status moved to DELIVERED_TO_WAREHOUSE");
    check(deliveredShipment?.deliveredToWarehouseAt !== undefined, "5.5B deliveredToWarehouseAt timestamp recorded");

    // CRITICAL INVARIANT: Delivery to warehouse does NOT automatically mark return accepted or refund!
    const returnStillApproved = await ReturnRequest.findById(returnRequest._id);
    check(returnStillApproved?.status === "APPROVED", "5.6 Physical delivery to warehouse does NOT automatically accept return (remains APPROVED pending staff receipt/inspection)");

    // =========================================================================
    // SECTION 6: Multiple Return Requests on Same Order (No Unique Index Collision)
    // =========================================================================
    console.log("\n--- Section 6: Multiple Return Requests Isolation ---");

    const secondReturn = await ReturnRequest.create({
      orderId: sampleOrder._id,
      userId: adminUser._id,
      items: [
        {
          productId: testProduct._id,
          variantId: testVariantId,
          quantity: 1,
          reason: "DAMAGED"
        }
      ],
      status: "APPROVED"
    });

    const secondBookReq: any = {
      params: { id: secondReturn._id.toString() },
      body: {
        courierId: "6a06d0daea73ccc9fd278960",
        pickupAddress: {
          fullName: "Ananya Roy",
          phone: "9876543210",
          addressLine1: "42 Park Street",
          city: "Kolkata",
          state: "West Bengal",
          postalCode: "700016",
          country: "India"
        },
        packageDetails: { weightGrams: 500, lengthCm: 25, widthCm: 20, heightCm: 10 }
      },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };

    axiosInst.defaults.adapter = async (config: any) => ({
      status: 200,
      statusText: "OK",
      headers: {},
      config,
      data: {
        success: true,
        data: {
          booking: {
            order_id: "REV-NIMBUS-ORD-992",
            awb: "142857009999",
            courier_name: "Delhivery Air Reverse",
            status: "booked"
          }
        }
      }
    });

    const secondBookRes = createMockRes();
    await bookReversePickup(secondBookReq, secondBookRes as any, (err?: any) => { if (err) throw err; });
    check(secondBookRes.statusCode === 201, "6.1 Second return request booked successfully on same order (no unique index collision)");
    const totalOrderReverses = await ReverseShipment.countDocuments({ orderId: sampleOrder._id });
    check(totalOrderReverses === 2, "6.2 Two distinct reverse shipments exist for the same order");

    // =========================================================================
    // SECTION 7: Manual Customer Shipping Fallback
    // =========================================================================
    console.log("\n--- Section 7: Manual Return Shipping Fallback ---");

    const thirdReturn = await ReturnRequest.create({
      orderId: sampleOrder._id,
      userId: adminUser._id,
      items: [
        {
          productId: testProduct._id,
          variantId: testVariantId,
          quantity: 1,
          reason: "OTHER"
        }
      ],
      status: "APPROVED"
    });

    const manualReq: any = {
      params: { id: thirdReturn._id.toString() },
      body: {
        carrier: "India Post Speed Post",
        trackingNumber: "SP123456789IN",
        adminNote: "Customer sent receipt via email"
      },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const manualRes = createMockRes();
    await manualReturnShipping(manualReq, manualRes as any, (err?: any) => { if (err) throw err; });

    check(manualRes.statusCode === 200, "7.1 manualReturnShipping succeeds with 200 OK");
    const manualRet = await ReturnRequest.findById(thirdReturn._id);
    check(manualRet?.returnShippingMethod === "CUSTOMER_SHIPS", "7.2 returnShippingMethod set to CUSTOMER_SHIPS");
    check(manualRet?.returnAwbNumber === "SP123456789IN", "7.3 Manual tracking number saved");
    check(manualRet?.returnCarrier === "India Post Speed Post", "7.4 Manual carrier name saved");

    // =========================================================================
    // SECTION 8: Safe Inspection Acceptance & Proportional Refund
    // =========================================================================
    console.log("\n--- Section 8: Inspection Acceptance, Refund & Inventory Ledger ---");

    // Advance returnRequest to INSPECTING
    returnRequest.status = "INSPECTING";
    await returnRequest.save();

    const acceptReq: any = {
      params: { id: returnRequest._id.toString() },
      body: { adminNote: "Item in unworn condition with tags" },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const acceptRes = createMockRes();
    await acceptReturn(acceptReq, acceptRes as any, (err?: any) => { if (err) throw err; });

    // Test getReturnReverseShipment
    const getRevShipReq: any = {
      params: { id: returnRequest._id.toString() },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const getRevShipRes = createMockRes();
    await getReturnReverseShipment(getRevShipReq, getRevShipRes as any, (err?: any) => { if (err) throw err; });
    check(getRevShipRes.statusCode === 200, "8.5 getReturnReverseShipment returns 200 OK");
    check(getRevShipRes.data?.data?.awbNumber === "142857009988", "8.6 Reverse shipment details retrieved");

    // Test rejectReturnAfterInspection
    const rejectRet = await ReturnRequest.create({
      orderId: sampleOrder._id,
      userId: adminUser._id,
      items: [{ productId: testProduct._id, variantId: testVariantId, quantity: 1, reason: "OTHER" }],
      status: "INSPECTING"
    });
    const rejectReq: any = {
      params: { id: rejectRet._id.toString() },
      body: { adminNote: "Item washed and damaged by user" },
      user: { id: adminUser._id.toString(), role: "ADMIN" }
    };
    const rejectRes = createMockRes();
    await rejectReturnAfterInspection(rejectReq, rejectRes as any, (err?: any) => { if (err) throw err; });
    check(rejectRes.statusCode === 200, "8.7 rejectReturnAfterInspection succeeds with 200");
    const rejectedDoc = await ReturnRequest.findById(rejectRet._id);
    check(rejectedDoc?.status === "REJECTED_AFTER_INSPECTION", "8.8 Return marked REJECTED_AFTER_INSPECTION");
    check(rejectedDoc?.refundId === undefined, "8.9 Rejected return does NOT trigger refund");

    check(acceptRes.statusCode === 200, "8.1 acceptReturn succeeds with 200 OK");
    const finalReturn = await ReturnRequest.findById(returnRequest._id);
    check(finalReturn?.status === "ACCEPTED", "8.2 ReturnRequest status moved to ACCEPTED");
    check(finalReturn?.refundId !== undefined, "8.3 Razorpay refund created and linked");

    const finalProduct = await Product.findById(testProduct._id);
    const finalVariant = finalProduct?.variants.find((v: any) => v._id.toString() === testVariantId.toString());
    check(finalVariant?.stock === 21, "8.4 Inventory stock restored by +1 on inspection acceptance (20 -> 21)");

  } finally {
    // Cleanup
    process.env.NIMBUSPOST_API_KEY = origKey;
    process.env.NIMBUSPOST_API_SECRET = origSecret;
    process.env.ORIGIN_POSTAL_CODE = origOriginPin;

    await ReturnRequest.deleteMany({ orderId: sampleOrder._id });
    await ReverseShipment.deleteMany({ orderId: sampleOrder._id });
    await Order.deleteMany({ orderNumber: /^TEST-REV-/ });
    await Product.deleteMany({ name: "Test Returnable Kurta" });
    await User.deleteMany({ email: "test-reverse-admin@samratfashion.com" });
    await Payment.deleteMany({ orderId: sampleOrder._id });
    await PaymentAttempt.deleteMany({ orderId: sampleOrder._id });

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
