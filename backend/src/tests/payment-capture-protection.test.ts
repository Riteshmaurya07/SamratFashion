/**
 * Payment capture protection suite.
 *
 * Proves the five guarantees added after the SF-2026-350853 incident:
 *  1. A failed UPI attempt does not permanently prevent a later successful capture.
 *  2. A captured payment is never overwritten by a late failure event.
 *  3. Reconciliation verifies the attempt belongs to the correct internal order.
 *  4. A captured payment is never left without a Payment record or a
 *     refund/reconciliation record.
 *  5. Customers cannot pay again while a captured payment awaits reconciliation.
 */

import mongoose from "mongoose";
import { Request, Response } from "express";
import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { Product } from "../models/Product";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { processPaymentSuccess } from "../services/payment/paymentProcessor";
import { processSupportedWebhookEvent } from "../controllers/webhookController";
import { createPaymentOrder } from "../controllers/paymentController";
import {
  assertReconciliationLinkage,
  ReconciliationLinkageError,
} from "../services/payment/paymentReconciliationGuard";
import "../models/Cart";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failures.push(description);
    failed++;
  }
}

interface OrderFixtureOptions {
  userId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  quantity: number;
  unitPrice: number;
  status?: "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  paymentStatus?: "PENDING" | "PAID" | "FAILED";
}

function createOrderFixture(options: OrderFixtureOptions) {
  const lineTotal = options.quantity * options.unitPrice;
  return Order.create({
    orderNumber: `PROT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    userId: options.userId,
    items: [
      {
        productId: options.productId,
        variantId: options.variantId,
        productName: "Capture protection item",
        productImage: "https://example.com/item.jpg",
        selectedSize: "M",
        selectedColor: "BLACK",
        quantity: options.quantity,
        unitPrice: options.unitPrice,
        lineTotal,
        isCustomized: false,
      },
    ],
    shippingAddress: {
      fullName: "Test Customer",
      phone: "9876543210",
      addressLine1: "Test Road",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560038",
      country: "India",
      addressType: "HOME",
    },
    subtotal: lineTotal,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: lineTotal,
    currency: "INR",
    status: options.status || "PENDING",
    paymentStatus: options.paymentStatus || "PENDING",
  });
}

function paymentFailureEvent(razorpayOrderId: string, paymentId: string, code: string) {
  return {
    payload: {
      payment: {
        entity: {
          order_id: razorpayOrderId,
          id: paymentId,
          error_code: code,
          error_description: "Simulated gateway failure",
        },
      },
    },
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

async function runTests(): Promise<void> {
  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const orderIds: mongoose.Types.ObjectId[] = [];
  const paymentIds: mongoose.Types.ObjectId[] = [];
  const attemptIds: mongoose.Types.ObjectId[] = [];
  let cleanupProductId: mongoose.Types.ObjectId | null = null;

  try {
    const productRes = await createTestProduct({
      name: `Capture protection tee ${Date.now()}`,
      variants: [{ size: "M", color: "BLACK", stock: 10 }],
    });
    const productId = new mongoose.Types.ObjectId(productRes.product._id);
    const variantId = new mongoose.Types.ObjectId(productRes.variantIds[0]);
    cleanupProductId = productId;

    // ── 1. Failed attempt does not block a later capture ─────────────────────
    console.log("\n[1] Failed UPI attempt -> later successful capture");
    const orderA = await createOrderFixture({ userId, productId, variantId, quantity: 2, unitPrice: 500 });
    orderIds.push(orderA._id);
    const paymentA = await Payment.create({
      orderId: orderA._id,
      userId,
      amount: orderA.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentA._id);
    const rzpOrderA = `order_prot_a_${Date.now()}`;
    const attemptA = await PaymentAttempt.create({
      paymentId: paymentA._id,
      orderId: orderA._id,
      razorpayOrderId: rzpOrderA,
      amount: orderA.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptA._id);

    const failOutcome = await processSupportedWebhookEvent(
      "payment.failed",
      paymentFailureEvent(rzpOrderA, "pay_failed_upi", "BAD_REQUEST_ERROR")
    );
    check(failOutcome.outcome === "PROCESSED", "1.1 payment.failed event is processed");
    const attemptAfterFailure = await PaymentAttempt.findById(attemptA._id);
    check(attemptAfterFailure?.status === "FAILED", "1.2 failed UPI attempt is recorded as FAILED");
    check(
      (await Order.findById(orderA._id))?.paymentStatus === "FAILED",
      "1.3 failed UPI attempt marks the order paymentStatus FAILED"
    );

    const captureResult = await processPaymentSuccess(rzpOrderA, "pay_success_upi");
    check(captureResult?.success === true, "1.4 later capture is applied despite the earlier failure");
    const orderAfterCapture = await Order.findById(orderA._id);
    check(
      orderAfterCapture?.status === "CONFIRMED" && orderAfterCapture.paymentStatus === "PAID",
      "1.5 order is PAID + CONFIRMED after the capture"
    );
    const attemptAfterCapture = await PaymentAttempt.findById(attemptA._id);
    check(
      attemptAfterCapture?.status === "CAPTURED" && attemptAfterCapture.razorpayPaymentId === "pay_success_upi",
      "1.6 attempt is CAPTURED with the successful payment id"
    );
    check(attemptAfterCapture?.failureCode === undefined, "1.7 stale failure code is cleared");
    const paymentAfterCapture = await Payment.findById(paymentA._id);
    check(
      paymentAfterCapture?.status === "CAPTURED" && paymentAfterCapture.razorpayPaymentId === "pay_success_upi",
      "1.8 payment record is CAPTURED with the successful payment id"
    );
    const productAfterCapture = await Product.findById(productId);
    const stockAfterCapture = (productAfterCapture?.variants as any)?.id(variantId)?.stock;
    check(stockAfterCapture === 8, "1.9 stock is deducted exactly once");

    // ── 2. Late failure must never overwrite a capture ───────────────────────
    console.log("\n[2] Late payment.failed after capture");
    const lateFailure = await processSupportedWebhookEvent(
      "payment.failed",
      paymentFailureEvent(rzpOrderA, "pay_failed_late", "GATEWAY_ERROR")
    );
    check(lateFailure.outcome === "PROCESSED", "2.1 late failure event is acknowledged");
    const attemptAfterLate = await PaymentAttempt.findById(attemptA._id);
    check(attemptAfterLate?.status === "CAPTURED", "2.2 late failure does not overwrite the CAPTURED attempt");
    check(attemptAfterLate?.failureCode === undefined, "2.3 late failure does not write failure metadata");
    const orderAfterLate = await Order.findById(orderA._id);
    check(orderAfterLate?.paymentStatus === "PAID", "2.4 late failure does not overwrite the PAID order");
    const paymentAfterLate = await Payment.findById(paymentA._id);
    check(
      paymentAfterLate?.status === "CAPTURED" && paymentAfterLate.razorpayPaymentId === "pay_success_upi",
      "2.5 late failure does not overwrite the CAPTURED payment record"
    );
    const productAfterLate = await Product.findById(productId);
    check(
      (productAfterLate?.variants as any)?.id(variantId)?.stock === 8,
      "2.6 late failure does not re-run inventory deduction"
    );

    // ── 3. Reconciliation identity linkage ───────────────────────────────────
    console.log("\n[3] Reconciliation linkage verification");
    const orderId = new mongoose.Types.ObjectId();
    const otherOrderId = new mongoose.Types.ObjectId();

    let rejectedAttemptMismatch = false;
    try {
      assertReconciliationLinkage({
        order: { _id: orderId },
        attempt: { orderId: otherOrderId, razorpayOrderId: "order_link" },
        gatewayOrderId: "order_link",
      });
    } catch (err) {
      rejectedAttemptMismatch = err instanceof ReconciliationLinkageError;
    }
    check(rejectedAttemptMismatch, "3.1 attempt attached to a different internal order is rejected");

    let rejectedGatewayMismatch = false;
    try {
      assertReconciliationLinkage({
        order: { _id: orderId },
        attempt: { orderId, razorpayOrderId: "order_other" },
        gatewayOrderId: "order_link",
      });
    } catch (err) {
      rejectedGatewayMismatch = err instanceof ReconciliationLinkageError;
    }
    check(rejectedGatewayMismatch, "3.2 attempt bound to a different gateway order is rejected");

    let rejectedPaymentMismatch = false;
    try {
      assertReconciliationLinkage({
        order: { _id: orderId },
        attempt: { orderId, razorpayOrderId: "order_link" },
        payment: { _id: new mongoose.Types.ObjectId(), orderId: otherOrderId },
        gatewayOrderId: "order_link",
      });
    } catch (err) {
      rejectedPaymentMismatch = err instanceof ReconciliationLinkageError;
    }
    check(rejectedPaymentMismatch, "3.3 payment record belonging to another order is rejected");

    let acceptedValidLinkage = true;
    try {
      assertReconciliationLinkage({
        order: { _id: orderId },
        attempt: { orderId, razorpayOrderId: "order_link" },
        payment: { _id: new mongoose.Types.ObjectId(), orderId },
        gatewayOrderId: "order_link",
      });
    } catch {
      acceptedValidLinkage = false;
    }
    check(acceptedValidLinkage, "3.4 a correctly linked attempt/payment is accepted");

    // ── 4. Capture records always exist ──────────────────────────────────────
    console.log("\n[4] Captured payments always have a record");
    const orderB = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderB._id);
    const rzpOrderB = `order_prot_b_${Date.now()}`;
    const missingPaymentId = new mongoose.Types.ObjectId();
    const attemptB = await PaymentAttempt.create({
      paymentId: missingPaymentId,
      orderId: orderB._id,
      razorpayOrderId: rzpOrderB,
      amount: orderB.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptB._id);
    check((await Payment.findById(missingPaymentId)) === null, "4.1 fixture starts with no Payment record");

    const captureB = await processPaymentSuccess(rzpOrderB, "pay_orphan_capture");
    check(captureB?.success === true, "4.2 capture succeeds even when the Payment record is missing");
    const createdPayment = await Payment.findById(missingPaymentId);
    check(
      createdPayment?.status === "CAPTURED" &&
        createdPayment.razorpayPaymentId === "pay_orphan_capture" &&
        createdPayment.orderId.toString() === orderB._id.toString(),
      "4.3 missing Payment record is created and linked to the captured payment"
    );
    if (createdPayment) paymentIds.push(createdPayment._id);

    const orderC = await createOrderFixture({
      userId,
      productId,
      variantId,
      quantity: 1,
      unitPrice: 1000,
      status: "EXPIRED",
      paymentStatus: "FAILED",
    });
    orderIds.push(orderC._id);
    const paymentC = await Payment.create({
      orderId: orderC._id,
      userId,
      amount: orderC.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentC._id);
    const rzpOrderC = `order_prot_c_${Date.now()}`;
    const attemptC = await PaymentAttempt.create({
      paymentId: paymentC._id,
      orderId: orderC._id,
      razorpayOrderId: rzpOrderC,
      amount: orderC.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptC._id);

    const captureC = await processPaymentSuccess(rzpOrderC, "pay_closed_order");
    check(
      captureC?.success === false && captureC.reason === "ORDER_CANCELLED",
      "4.4 capture on a closed order is not applied"
    );
    const flaggedPayment = await Payment.findById(paymentC._id);
    check(
      flaggedPayment?.status === "CAPTURED" && flaggedPayment.razorpayPaymentId === "pay_closed_order",
      "4.5 captured money on a closed order is still recorded on the Payment"
    );
    check(
      flaggedPayment?.reconciliationRequired === true && Boolean(flaggedPayment.reconciliationReason),
      "4.6 captured money on a closed order is flagged for reconciliation/refund"
    );

    // ── 5. No second payment while reconciliation is pending ─────────────────
    console.log("\n[5] Re-payment is blocked while a capture awaits reconciliation");
    const orderD = await createOrderFixture({
      userId,
      productId,
      variantId,
      quantity: 1,
      unitPrice: 1000,
      status: "PENDING",
      paymentStatus: "FAILED",
    });
    orderIds.push(orderD._id);
    const paymentD = await Payment.create({
      orderId: orderD._id,
      userId,
      amount: orderD.total,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: "pay_pending_reconcile",
      reconciliationRequired: true,
      reconciliationReason: "Test fixture awaiting reconciliation",
    });
    paymentIds.push(paymentD._id);

    const requestD = {
      user: { id: userId.toString() },
      body: { orderId: orderD._id.toString() },
    } as unknown as Request;
    const responseD = mockResponse();
    await createPaymentOrder(requestD, responseD as unknown as Response);
    check(responseD.statusCode === 409, "5.1 retry is rejected with 409");
    check(
      typeof (responseD.body as { message?: string })?.message === "string" &&
        /reconciliation/i.test((responseD.body as { message: string }).message),
      "5.2 retry explains that reconciliation is required"
    );
    check(
      (await PaymentAttempt.countDocuments({ orderId: orderD._id })) === 0,
      "5.3 no new gateway attempt is created for a reconciled capture"
    );

    // Even without the flag, a CAPTURED attempt on an unpaid order blocks retry.
    const orderE = await createOrderFixture({
      userId,
      productId,
      variantId,
      quantity: 1,
      unitPrice: 1000,
      status: "PENDING",
      paymentStatus: "FAILED",
    });
    orderIds.push(orderE._id);
    const paymentE = await Payment.create({
      orderId: orderE._id,
      userId,
      amount: orderE.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentE._id);
    const attemptE = await PaymentAttempt.create({
      paymentId: paymentE._id,
      orderId: orderE._id,
      razorpayOrderId: `order_prot_e_${Date.now()}`,
      amount: orderE.total,
      currency: "INR",
      status: "CAPTURED",
      razorpayPaymentId: "pay_captured_unapplied",
    });
    attemptIds.push(attemptE._id);

    const requestE = {
      user: { id: userId.toString() },
      body: { orderId: orderE._id.toString() },
    } as unknown as Request;
    const responseE = mockResponse();
    await createPaymentOrder(requestE, responseE as unknown as Response);
    check(responseE.statusCode === 409, "5.4 a CAPTURED attempt without the flag also blocks re-payment");
    check(
      (await PaymentAttempt.countDocuments({ orderId: orderE._id })) === 1,
      "5.5 no additional attempt is created for the CAPTURED attempt case"
    );
  } finally {
    await InventoryTransaction.deleteMany({ orderId: { $in: orderIds } }).catch(() => undefined);
    await PaymentAttempt.deleteMany({ _id: { $in: attemptIds } }).catch(() => undefined);
    await Payment.deleteMany({ _id: { $in: paymentIds } }).catch(() => undefined);
    await Order.deleteMany({ _id: { $in: orderIds } }).catch(() => undefined);
    if (cleanupProductId) {
      await Product.deleteOne({ _id: cleanupProductId }).catch(() => undefined);
    }
    await mongoose.disconnect().catch(() => undefined);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(`Failed checks: ${JSON.stringify(failures, null, 2)}`);
    process.exit(1);
  }
}

runTests().catch((err: unknown) => {
  console.error("Unhandled test error:", err);
  process.exit(1);
});
