import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { Product, ProductStatus, IProduct } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";
import { BulkOrderRequest, BulkRequestStatus } from "../models/BulkOrderRequest";
import { BulkQuote, BulkQuoteStatus } from "../models/BulkQuote";
import { Order } from "../models/Order";
import { createCustomPrintingRequest } from "../controllers/customDesignController";
import { createBulkRequest, acceptQuote } from "../controllers/bulkOrderController";
import { createAdminQuote } from "../controllers/adminBulkOrderController";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, name: string, details?: string) {
  if (cond) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    const msg = `  ❌ FAIL: ${name}${details ? ` — ${details}` : ""}`;
    console.error(msg);
    failures.push(`${name}${details ? `: ${details}` : ""}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  data: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.data = payload;
      return res;
    },
  };
  return res;
}

async function runRedesignTests() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Custom Printing & Bulk Order Redesign Regression Tests      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  const testUserId = new mongoose.Types.ObjectId().toString();
  const testAdminId = new mongoose.Types.ObjectId().toString();

  try {
    // Setup test customizable product
    const variantId1 = new mongoose.Types.ObjectId();
    const variantId2 = new mongoose.Types.ObjectId();
    const testProduct = await Product.create({
      name: "Streetwear Boxy Blank Tee",
      slug: `streetwear-boxy-blank-tee-${Date.now()}`,
      description: "240 GSM Heavyweight Combed Cotton",
      categoryId: new mongoose.Types.ObjectId(),
      basePrice: 1299,
      images: ["https://example.com/tee-front.jpg"],
      status: ProductStatus.ACTIVE,
      isCustomizable: true,
      variants: [
        {
          _id: variantId1,
          size: "L",
          color: "Ink Black",
          sku: `SW-BLK-L-${Date.now()}`,
          stock: 50,
          additionalPrice: 0,
          images: ["https://example.com/tee-black.jpg"],
          isAvailable: true,
        },
        {
          _id: variantId2,
          size: "M",
          color: "White",
          sku: `SW-WHT-M-${Date.now()}`,
          stock: 0, // Out of stock
          additionalPrice: 0,
          images: ["https://example.com/tee-white.jpg"],
          isAvailable: false,
        },
      ],
    }) as unknown as IProduct;

    // ─── 1. CUSTOM PRINTING REQUESTS (PATH B) ──────────────────────────
    console.log("[1. Custom Printing Request Endpoint & Validation]");

    // Test 1.1: Rejects unauthenticated request
    {
      const req: unknown = { body: {} };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createCustomPrintingRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "CPR-1 Rejects unauthenticated request with 401");
    }

    // Test 1.2: Rejects unavailable/out-of-stock variant
    {
      const req: unknown = {
        user: { id: testUserId, role: "CUSTOMER" },
        body: {
          productId: testProduct._id.toString(),
          selectedVariantId: variantId2.toString(),
          selectedColor: "White",
          selectedSize: "M",
          instructions: "Screen print logo on chest",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createCustomPrintingRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "CPR-2 Rejects out-of-stock or unavailable variant");
    }

    // Test 1.3: Successfully creates request with PRINTING_REQUEST type
    let createdRequestId = "";
    const testIdempotencyKey = `idemp_req_${Date.now()}`;
    {
      const req: unknown = {
        user: { id: testUserId, role: "CUSTOMER" },
        body: {
          productId: testProduct._id.toString(),
          selectedVariantId: variantId1.toString(),
          selectedColor: "Ink Black",
          selectedSize: "L",
          instructions: "Direct-to-Film transfer 2 inches below collar, centered.",
          artwork: {
            url: "https://example.com/artwork.png",
            format: "png",
          },
          idempotencyKey: testIdempotencyKey,
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createCustomPrintingRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "CPR-3 Custom printing request creates successfully without error");
      check(res.statusCode === 201, "CPR-4 Returns HTTP 201 Created");

      const responseData = res.data as { success: boolean; data: { _id: string; requestType: string; status: string } };
      check(responseData?.success === true, "CPR-5 Response has success: true");
      check(responseData?.data?.requestType === "PRINTING_REQUEST", "CPR-6 Persists requestType as PRINTING_REQUEST");
      check(responseData?.data?.status === "REQUESTED", "CPR-7 Persists status as REQUESTED");
      createdRequestId = responseData?.data?._id ? String(responseData.data._id) : "";
    }

    // Test 1.4: Idempotency check prevents duplicate record
    {
      const req: unknown = {
        user: { id: testUserId, role: "CUSTOMER" },
        body: {
          productId: testProduct._id.toString(),
          selectedVariantId: variantId1.toString(),
          selectedColor: "Ink Black",
          selectedSize: "L",
          instructions: "Direct-to-Film transfer duplicate call",
          idempotencyKey: testIdempotencyKey,
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createCustomPrintingRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "CPR-8 Idempotent repeat call succeeds without throwing");
      const responseData = res.data as { success: boolean; duplicate: boolean; data: { _id: string } };
      check(responseData?.duplicate === true, "CPR-9 Idempotent repeat call flags duplicate: true");
      check(String(responseData?.data?._id) === createdRequestId, "CPR-10 Idempotent repeat call returns original request ID");
    }

    // ─── 2. BULK ORDER MOQ & CONTRACT VALIDATION ──────────────────────
    console.log("\n[2. Bulk Order Minimum Quantity & Lifecycle Validation]");

    // Test 2.1: Rejects quantity < 10 units
    {
      const req: unknown = {
        user: { id: testUserId, role: "CUSTOMER" },
        body: {
          organizationName: "Samrat Club",
          contactName: "Rohan Verma",
          email: "rohan@example.com",
          phone: "+919876543210",
          productId: testProduct._id.toString(),
          variantBreakdown: { S: 2, M: 2, L: 2, XL: 2, XXL: 1 }, // Total 9 units
          deliveryLocation: "Connaught Place, New Delhi",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(Boolean(caughtError), "BULK-1 Rejects bulk request with total quantity < 10 units");
    }

    // Test 2.2: Accepts quantity = 10 units (Approved MOQ)
    let createdBulkRequestId = "";
    let bulkQuoteNumber = "";
    {
      const req: unknown = {
        user: { id: testUserId, role: "CUSTOMER" },
        body: {
          organizationName: "Samrat Streetwear Co",
          contactName: "Rohan Verma",
          email: "rohan@example.com",
          phone: "+919876543210",
          productId: testProduct._id.toString(),
          variantBreakdown: { S: 2, M: 3, L: 3, XL: 2, XXL: 0 }, // Total 10 units
          colorAllocation: "Ink Black (10)",
          customPrintingRequired: true,
          printLocations: ["FRONT", "BACK"],
          deliveryLocation: "Hauz Khas, New Delhi",
          city: "New Delhi",
          state: "Delhi",
          postalCode: "110016",
          customerNote: "Urgent festival drop.",
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createBulkRequest(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "BULK-2 Accepts bulk request meeting authoritative MOQ of 10 units");
      check(res.statusCode === 201, "BULK-3 Bulk request returns HTTP 201 Created");

      const responseData = res.data as { success: boolean; data: { _id: string; quoteNumber: string; totalQuantity: number; status: string } };
      check(responseData?.data?.totalQuantity === 10, "BULK-4 Persisted totalQuantity is 10");
      check(responseData?.data?.status === BulkRequestStatus.REQUESTED, "BULK-5 Initial status is REQUESTED");
      createdBulkRequestId = responseData?.data?._id || "";
      bulkQuoteNumber = responseData?.data?.quoteNumber || "";
    }

    // ─── 3. ADMIN QUOTATION ISSUANCE & RUPEE/PAISE ORDER CONVERSION ───
    console.log("\n[3. Quotation Issuance & Order Conversion (Rupee / Paise Precision)]");

    // Test 3.1: Admin issues quotation
    // Product Price: ₹12,000, Print Fee: ₹2,000, Setup Fee: ₹500, Discount: ₹500, Shipping: ₹500
    // Subtotal: ₹14,000. Tax (18%): ₹2,520. Total: ₹17,020.
    let issuedQuoteId = "";
    {
      const req: unknown = {
        user: { id: testAdminId, role: "ADMIN" },
        params: { id: createdBulkRequestId },
        body: {
          productPrice: 12000,
          printingFee: 2000,
          setupFee: 500,
          discount: 500,
          shipping: 500,
          validUntilDays: 14,
        },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await createAdminQuote(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "ADMIN-1 Admin quote generated without error");
      check(res.statusCode === 200, "ADMIN-2 Admin quote issuance returns 200");

      const bulkQuoteRecord = await BulkQuote.findOne({ quoteNumber: bulkQuoteNumber });
      check(Boolean(bulkQuoteRecord), "ADMIN-3 BulkQuote document exists in MongoDB");
      // BulkQuote stores in paise:
      check(bulkQuoteRecord?.subtotal === 1400000, "ADMIN-4 BulkQuote subtotal stored in paise (1,400,000)");
      check(bulkQuoteRecord?.tax === 252000, "ADMIN-5 BulkQuote tax stored in paise (252,000)");
      check(bulkQuoteRecord?.total === 1702000, "ADMIN-6 BulkQuote total stored in paise (1,702,000)");
      check(bulkQuoteRecord?.status === BulkQuoteStatus.SENT, "ADMIN-7 BulkQuote status marked as SENT");
      issuedQuoteId = bulkQuoteRecord?._id.toString() || "";
    }

    // Test 3.2: Customer accepts quotation -> Creates Order with RUPEE amounts (NOT paise!)
    {
      const req: unknown = {
        user: { id: testUserId, role: "CUSTOMER" },
        params: { quoteId: issuedQuoteId },
      };
      const res = createMockRes();
      let caughtError: unknown = null;
      await acceptQuote(req as never, res as never, (err: unknown) => {
        caughtError = err;
      });
      check(!caughtError, "CONV-1 Customer accepts quote without error");
      check(res.statusCode === 200, "CONV-2 Accept quote returns HTTP 200");

      const responseData = res.data as {
        success: boolean;
        data: {
          quote: { status: string };
          order: { _id: string; total: number; subtotal: number; tax: number; shipping: number };
        };
      };

      const createdOrder = await Order.findById(responseData?.data?.order?._id);
      check(Boolean(createdOrder), "CONV-3 Converted Order document created in MongoDB");

      // Verify that order amounts are in RUPEES, NOT in paise! (17020 rupees, NOT 1702000)
      check(createdOrder?.total === 17020, `CONV-4 Order total is ₹17,020 (actual: ${createdOrder?.total})`);
      check(createdOrder?.subtotal === 14000, `CONV-5 Order subtotal is ₹14,000 (actual: ${createdOrder?.subtotal})`);
      check(createdOrder?.tax === 2520, `CONV-6 Order tax is ₹2,520 (actual: ${createdOrder?.tax})`);
      check(createdOrder?.shipping === 500, `CONV-7 Order shipping is ₹500 (actual: ${createdOrder?.shipping})`);

      // Verify payment amount in paise in payment processor would equal order.total * 100 = 1,702,000 paise = ₹17,020
      const paymentPaise = Math.round((createdOrder?.total || 0) * 100);
      check(paymentPaise === 1702000, "CONV-8 Razorpay payment amount in paise matches quote paise exactly without 100x overcharge");

      // Verify quote status changed to ACCEPTED
      const updatedQuote = await BulkQuote.findById(issuedQuoteId);
      check(updatedQuote?.status === BulkQuoteStatus.ACCEPTED, "CONV-9 Quote marked as ACCEPTED");

      // Verify bulk request status changed to ACCEPTED
      const updatedReq = await BulkOrderRequest.findById(createdBulkRequestId);
      check(updatedReq?.status === BulkRequestStatus.ACCEPTED, "CONV-10 Bulk request marked as ACCEPTED");
    }

    // Cleanup test artifacts
    await Product.deleteOne({ _id: testProduct._id });
    if (createdRequestId) await CustomDesign.deleteOne({ _id: createdRequestId });
    if (createdBulkRequestId) await BulkOrderRequest.deleteOne({ _id: createdBulkRequestId });
    if (issuedQuoteId) await BulkQuote.deleteOne({ _id: issuedQuoteId });
  } finally {
    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB");
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runRedesignTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
