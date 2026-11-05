import mongoose from "mongoose";
import { Request, Response, NextFunction } from "express";
import { connectSafeTestDb } from "./testHelpers";
import { Order } from "../models/Order";
import { Review } from "../models/Review";
import { createReview } from "../controllers/reviewController";

let passed = 0;
let failed = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  body: any;
  status(code: number): this;
  json(body: any): this;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
  return res;
}

async function runReviewDeliveryValidationTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Review Delivery Verification & Undelivered Rejection Tests    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();

  const customerId = new mongoose.Types.ObjectId();
  const strangerId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];
  const cleanupReviewIds: mongoose.Types.ObjectId[] = [];

  try {
    const createOrderWithStatus = async (status: 'CANCELLED' | 'CONFIRMED' | 'DELIVERED' | 'EXPIRED' | 'PENDING' | 'PROCESSING' | 'SHIPPED') => {
      const order: any = await Order.create({
        orderNumber: `ORD-REV-${status}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: customerId,
        items: [{
          productId,
          variantId,
          productName: "Review Test Kurta",
          productImage: "https://example.com/kurta.jpg",
          selectedSize: "L",
          selectedColor: "NAVY",
          quantity: 1,
          unitPrice: 1500,
          lineTotal: 1500,
        }],
        shippingAddress: {
          fullName: "Test Customer",
          phone: "9876543210",
          addressLine1: "123 MG Road",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560001",
          country: "India",
          addressType: "HOME",
        },
        subtotal: 1500,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 1500,
        currency: "INR",
        status,
        paymentStatus: status === "CANCELLED" ? "REFUNDED" : "PAID",
        deliveredAt: status === "DELIVERED" ? new Date() : undefined,
      });
      cleanupOrderIds.push(order._id);
      return order;
    };

    const invokeCreateReview = async (user: { id: string; role: string }, body: any) => {
      let capturedError: any = null;
      const req = {
        user,
        body,
      } as unknown as Request;
      const res = createMockRes();
      const next: NextFunction = (err) => {
        capturedError = err;
      };

      await createReview(req, res as unknown as Response, next);
      return { statusCode: res.statusCode, body: res.body, error: capturedError };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 1. REJECT REVIEWS FOR UNDELIVERED STATUSES
    // ─────────────────────────────────────────────────────────────────────────
    const undeliveredStatuses = ["PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "CANCELLED"] as const;

    for (const status of undeliveredStatuses) {
      const order = await createOrderWithStatus(status);
      const orderItemId = order.items[0]._id!.toString();

      const outcome = await invokeCreateReview(
        { id: customerId.toString(), role: "CUSTOMER" },
        {
          productId: productId.toString(),
          orderId: order._id.toString(),
          orderItemId,
          rating: 5,
          title: "Great quality",
          body: "The fabric quality and stitching are top notch!",
        }
      );

      check(
        outcome.error !== null &&
          outcome.error.statusCode === 400 &&
          outcome.error.message.includes("You can only review an item after its order has been delivered"),
        `Rejects review submission for order in '${status}' status with 400`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. ACCEPT REVIEW FOR DELIVERED ORDER
    // ─────────────────────────────────────────────────────────────────────────
    const deliveredOrder = await createOrderWithStatus("DELIVERED");
    const deliveredItemId = deliveredOrder.items[0]._id!.toString();

    const deliveredOutcome = await invokeCreateReview(
      { id: customerId.toString(), role: "CUSTOMER" },
      {
        productId: productId.toString(),
        orderId: deliveredOrder._id.toString(),
        orderItemId: deliveredItemId,
        rating: 5,
        title: "Verified Delivery Review",
        body: "Received the delivery yesterday and the fit is perfect!",
      }
    );

    check(
      deliveredOutcome.error === null &&
        deliveredOutcome.statusCode === 201 &&
        deliveredOutcome.body?.success === true &&
        deliveredOutcome.body?.data?.isVerifiedPurchase === true,
      "Accepts review submission for DELIVERED order with 201 and isVerifiedPurchase: true"
    );

    if (deliveredOutcome.body?.data?._id) {
      cleanupReviewIds.push(new mongoose.Types.ObjectId(deliveredOutcome.body.data._id));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. REJECT DUPLICATE REVIEW FOR SAME ORDER ITEM
    // ─────────────────────────────────────────────────────────────────────────
    const duplicateOutcome = await invokeCreateReview(
      { id: customerId.toString(), role: "CUSTOMER" },
      {
        productId: productId.toString(),
        orderId: deliveredOrder._id.toString(),
        orderItemId: deliveredItemId,
        rating: 4,
        title: "Trying duplicate",
        body: "Attempting to review the exact same purchased item again.",
      }
    );

    check(
      duplicateOutcome.error !== null &&
        duplicateOutcome.error.statusCode === 400 &&
        duplicateOutcome.error.message.includes("already submitted a review"),
      "Rejects duplicate review submission for the same order item with 400"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 4. CROSS-USER ISOLATION: STRANGER CANNOT REVIEW ANOTHER USER'S DELIVERED ORDER
    // ─────────────────────────────────────────────────────────────────────────
    const strangerOutcome = await invokeCreateReview(
      { id: strangerId.toString(), role: "CUSTOMER" },
      {
        productId: productId.toString(),
        orderId: deliveredOrder._id.toString(),
        orderItemId: deliveredItemId,
        rating: 1,
        title: "Unauthorized review",
        body: "I should not be able to review another customer's delivered order.",
      }
    );

    check(
      strangerOutcome.error !== null &&
        strangerOutcome.error.statusCode === 400 &&
        strangerOutcome.error.message.includes("Order not found"),
      "Rejects review submission by a stranger on another customer's delivered order with 400"
    );

  } finally {
    if (cleanupReviewIds.length > 0) {
      await Review.deleteMany({ _id: { $in: cleanupReviewIds } });
    }
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
    }
    await mongoose.disconnect();
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runReviewDeliveryValidationTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
