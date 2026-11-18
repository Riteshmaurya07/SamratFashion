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
import { Refund } from "../models/Refund";
import { DuplicateCaptureRefund } from "../models/DuplicateCaptureRefund";
import { Product } from "../models/Product";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { razorpayProvider, RazorpayRefundResult } from "../services/payment/RazorpayProvider";
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

    // A replay after the order/attempt commit repairs a missing or stale Payment
    // document without treating the already-applied capture as a duplicate.
    const originalCreateRefund = razorpayProvider.createRefund;
    let replayRefundCalls = 0;
    razorpayProvider.createRefund = async (..._args: Parameters<typeof razorpayProvider.createRefund>) => {
      replayRefundCalls++;
      throw new Error("Same-capture replay must not submit a refund");
    };
    try {
      await Payment.deleteOne({ _id: paymentA._id });
      const missingPaymentReplay = await processPaymentSuccess(rzpOrderA, "pay_success_upi");
      const repairedMissingPayment = await Payment.findById(paymentA._id);
      check(
        missingPaymentReplay?.success === true &&
          repairedMissingPayment?.status === "CAPTURED" &&
          repairedMissingPayment.razorpayPaymentId === "pay_success_upi",
        "2.7 same-capture replay recreates a missing Payment record"
      );

      await Payment.updateOne(
        { _id: paymentA._id },
        { $set: { status: "PENDING", razorpayPaymentId: "pay_stale_record" } }
      );
      const stalePaymentReplay = await processPaymentSuccess(rzpOrderA, "pay_success_upi");
      const repairedStalePayment = await Payment.findById(paymentA._id);
      const productAfterReplay = await Product.findById(productId);
      check(
        stalePaymentReplay?.success === true &&
          repairedStalePayment?.status === "CAPTURED" &&
          repairedStalePayment.razorpayPaymentId === "pay_success_upi",
        "2.8 same-capture replay repairs a stale Payment record"
      );
      check(
        replayRefundCalls === 0 &&
          (productAfterReplay?.variants as any)?.id(variantId)?.stock === 8,
        "2.9 Payment repair neither refunds nor deducts inventory again"
      );
    } finally {
      razorpayProvider.createRefund = originalCreateRefund;
    }

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
    const closedAttempt = await PaymentAttempt.findById(attemptC._id);
    check(
      (await Order.findById(orderC._id))?.status === "EXPIRED" &&
        closedAttempt?.status === "CAPTURED" &&
        closedAttempt.razorpayPaymentId === "pay_closed_order",
      "4.7 closed order remains closed while its captured attempt is recorded"
    );

    const orderG = await createOrderFixture({
      userId,
      productId,
      variantId,
      quantity: 1,
      unitPrice: 1000,
      status: "CANCELLED",
      paymentStatus: "FAILED",
    });
    orderIds.push(orderG._id);
    const paymentG = await Payment.create({
      orderId: orderG._id,
      userId,
      amount: orderG.total,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: "pay_closed_primary",
    });
    paymentIds.push(paymentG._id);
    const attemptG = await PaymentAttempt.create({
      paymentId: paymentG._id,
      orderId: orderG._id,
      razorpayOrderId: `order_closed_duplicate_${Date.now()}`,
      amount: orderG.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptG._id);
    const originalCreateRefundForClosedDuplicate = razorpayProvider.createRefund;
    const closedDuplicateCaptureId = "pay_closed_duplicate";
    razorpayProvider.createRefund = async (
      _paymentId,
      amount,
      _notes,
      _idempotencyKey
    ): Promise<RazorpayRefundResult> => ({
      id: "rfnd_closed_duplicate",
      entity: "refund",
      amount,
      status: "processed",
    });
    try {
      await processPaymentSuccess(attemptG.razorpayOrderId, closedDuplicateCaptureId);
    } finally {
      razorpayProvider.createRefund = originalCreateRefundForClosedDuplicate;
    }
    const paymentGAfter = await Payment.findById(paymentG._id);
    const duplicateClosedCapture = await DuplicateCaptureRefund.findOne({ paymentAttemptId: attemptG._id });
    check(
      paymentGAfter?.status === "CAPTURED" &&
        paymentGAfter.razorpayPaymentId === "pay_closed_primary" &&
        (paymentGAfter.reconciliationRequired === false || paymentGAfter.reconciliationRequired === true) &&
        duplicateClosedCapture?.capturePaymentId === closedDuplicateCaptureId &&
        duplicateClosedCapture.status === "PROCESSED" &&
        (await Order.findById(orderG._id))?.status === "CANCELLED",
      "4.8 distinct capture on a closed order preserves the primary payment and tracks/refunds the duplicate"
    );

    const orderP = await createOrderFixture({
      userId,
      productId,
      variantId,
      quantity: 1,
      unitPrice: 1000,
      status: "CANCELLED",
      paymentStatus: "FAILED",
    });
    orderIds.push(orderP._id);
    const paymentP = await Payment.create({
      orderId: orderP._id,
      userId,
      amount: orderP.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentP._id);
    const primaryCaptureP = "pay_closed_attempt_primary";
    const attemptP = await PaymentAttempt.create({
      paymentId: paymentP._id,
      orderId: orderP._id,
      razorpayOrderId: `order_closed_attempt_primary_${Date.now()}`,
      razorpayPaymentId: primaryCaptureP,
      amount: orderP.total,
      currency: "INR",
      status: "PROCESSING",
    });
    attemptIds.push(attemptP._id);
    const originalCreateRefundForAttemptConflict = razorpayProvider.createRefund;
    const distinctCaptureP = "pay_closed_attempt_distinct";
    razorpayProvider.createRefund = async (
      _paymentId,
      amount,
      _notes,
      _idempotencyKey
    ): Promise<RazorpayRefundResult> => ({
      id: "rfnd_closed_attempt_distinct",
      entity: "refund",
      amount,
      status: "processed",
    });
    try {
      await processPaymentSuccess(attemptP.razorpayOrderId, distinctCaptureP);
    } finally {
      razorpayProvider.createRefund = originalCreateRefundForAttemptConflict;
    }
    const paymentPAfter = await Payment.findById(paymentP._id);
    const attemptPAfter = await PaymentAttempt.findById(attemptP._id);
    const duplicateP = await DuplicateCaptureRefund.findOne({ paymentAttemptId: attemptP._id });
    check(
      paymentPAfter?.status === "CAPTURED" &&
        paymentPAfter.razorpayPaymentId === primaryCaptureP &&
        (paymentPAfter.reconciliationRequired === false || paymentPAfter.reconciliationRequired === true) &&
        attemptPAfter?.razorpayPaymentId === primaryCaptureP &&
        attemptPAfter.failureCode === "DUPLICATE_CAPTURE_REFUNDED" &&
        duplicateP?.capturePaymentId === distinctCaptureP &&
        duplicateP.status === "PROCESSED" &&
        (await Order.findById(orderP._id))?.status === "CANCELLED",
      "4.8a closed-order recovery preserves the attempt's primary capture while safely refunding a distinct capture"
    );

    const orderQ = await createOrderFixture({
      userId,
      productId,
      variantId,
      quantity: 1,
      unitPrice: 1000,
      status: "EXPIRED",
      paymentStatus: "FAILED",
    });
    orderIds.push(orderQ._id);
    const paymentQ = await Payment.create({
      orderId: orderQ._id,
      userId,
      amount: orderQ.total,
      currency: "INR",
      status: "REFUNDED",
      provider: "RAZORPAY",
      razorpayPaymentId: "pay_closed_refunded_primary",
    });
    paymentIds.push(paymentQ._id);
    const attemptQ = await PaymentAttempt.create({
      paymentId: paymentQ._id,
      orderId: orderQ._id,
      razorpayOrderId: `order_closed_refund_conflict_${Date.now()}`,
      amount: orderQ.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptQ._id);
    const refundQ = await Refund.create({
      orderId: orderQ._id,
      paymentId: paymentQ._id,
      userId,
      amount: orderQ.total,
      currency: "INR",
      status: "PROCESSED",
      initiatedBy: userId,
      initiatedByRole: "ADMIN",
    });
    const refundConflictCaptureId = "pay_closed_refund_conflict_capture";
    await processPaymentSuccess(attemptQ.razorpayOrderId, refundConflictCaptureId);
    const refundConflictReplay = await processPaymentSuccess(attemptQ.razorpayOrderId, refundConflictCaptureId);
    const paymentQAfter = await Payment.findById(paymentQ._id);
    const attemptQAfter = await PaymentAttempt.findById(attemptQ._id);
    const refundQAfter = await Refund.findById(refundQ._id);
    check(
      paymentQAfter?.status === "REFUNDED" &&
        paymentQAfter.razorpayPaymentId === "pay_closed_refunded_primary" &&
        attemptQAfter?.razorpayPaymentId === refundConflictCaptureId &&
        attemptQAfter.failureCode === "PAYMENT_RECONCILIATION_REQUIRED" &&
        refundConflictReplay?.success === false &&
        refundConflictReplay.reason === "PAYMENT_RECONCILIATION_REQUIRED" &&
        refundQAfter?.status === "PROCESSED" &&
        (await Order.findById(orderQ._id))?.status === "EXPIRED" &&
        (await Order.findById(orderQ._id))?.paymentStatus === "FAILED",
      "4.8b refund conflicts preserve refund, Payment, and closed-order state while retaining capture evidence"
    );

    // No internal order/payment with a matching customer and amount may be
    // inferred when the exact gateway-order attempt association is absent.
    const orderF = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderF._id);
    const paymentF = await Payment.create({
      orderId: orderF._id,
      userId,
      amount: orderF.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentF._id);
    const unmatchedGatewayOrderId = `order_unmatched_${Date.now()}`;
    const unmatchedCaptureId = `pay_unmatched_${Date.now()}`;
    const unmatchedCapture = await processSupportedWebhookEvent("payment.captured", {
      payload: {
        payment: {
          entity: { order_id: unmatchedGatewayOrderId, id: unmatchedCaptureId },
        },
      },
    });
    check(
      unmatchedCapture.outcome === "RECONCILIATION_REQUIRED" &&
        (await Payment.findById(paymentF._id))?.status === "PENDING" &&
        (await Payment.findOne({ razorpayPaymentId: unmatchedCaptureId })) === null &&
        (await PaymentAttempt.findOne({ razorpayOrderId: unmatchedGatewayOrderId })) === null,
      "4.9 capture without an exact attempt association is not auto-linked by customer or amount"
    );

    const orderH = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderH._id);
    const paymentH = await Payment.create({
      orderId: orderH._id,
      userId,
      amount: orderH.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentH._id);
    const gatewayOrderH = `order_capture_valid_${Date.now()}`;
    const attemptH = await PaymentAttempt.create({
      paymentId: paymentH._id,
      orderId: orderH._id,
      razorpayOrderId: gatewayOrderH,
      amount: orderH.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptH._id);
    const validCaptureId = `pay_capture_valid_${Date.now()}`;
    const validCaptureEvent = await processSupportedWebhookEvent("payment.captured", {
      payload: {
        payment: {
          entity: {
            order_id: gatewayOrderH,
            id: validCaptureId,
            amount: 100000,
            currency: "INR",
          },
        },
      },
    });
    check(
      validCaptureEvent.outcome === "PROCESSED" &&
        (await Order.findById(orderH._id))?.status === "CONFIRMED" &&
        (await Order.findById(orderH._id))?.paymentStatus === "PAID" &&
        (await Payment.findById(paymentH._id))?.razorpayPaymentId === validCaptureId,
      "4.10 exact capture association with matching paise amount and currency is applied"
    );
    const stockBeforePartialReplay = ((await Product.findById(productId))?.variants as any)?.id(variantId)?.stock;
    await PaymentAttempt.updateOne(
      { _id: attemptH._id },
      {
        $set: { status: "PROCESSING" },
        $unset: { razorpayPaymentId: 1, failureCode: 1, failureReason: 1 },
      }
    );
    await Payment.deleteOne({ _id: paymentH._id });
    const originalCreateRefundForPartialReplay = razorpayProvider.createRefund;
    let partialReplayRefundCalls = 0;
    razorpayProvider.createRefund = async (..._args: Parameters<typeof razorpayProvider.createRefund>) => {
      partialReplayRefundCalls++;
      throw new Error("Partial-write replay must not submit a duplicate refund");
    };
    let partialReplay: any;
    try {
      partialReplay = await processPaymentSuccess(gatewayOrderH, validCaptureId);
    } finally {
      razorpayProvider.createRefund = originalCreateRefundForPartialReplay;
    }
    const replayedPaymentH = await Payment.findById(paymentH._id);
    const replayedAttemptH = await PaymentAttempt.findById(attemptH._id);
    const stockAfterPartialReplay = ((await Product.findById(productId))?.variants as any)?.id(variantId)?.stock;
    check(
      partialReplay?.success === true &&
        replayedAttemptH?.status === "CAPTURED" &&
        replayedAttemptH.razorpayPaymentId === validCaptureId &&
        replayedPaymentH?.status === "CAPTURED" &&
        replayedPaymentH.razorpayPaymentId === validCaptureId &&
        partialReplayRefundCalls === 0 &&
        stockAfterPartialReplay === stockBeforePartialReplay &&
        (await Order.findById(orderH._id))?.paymentStatus === "PAID",
      "4.10a replay repairs an order-paid/attempt-processing partial write without refund or inventory rerun"
    );

    const orderI = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderI._id);
    const paymentI = await Payment.create({
      orderId: orderI._id,
      userId,
      amount: orderI.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentI._id);
    const gatewayOrderI = `order_capture_amount_mismatch_${Date.now()}`;
    const attemptI = await PaymentAttempt.create({
      paymentId: paymentI._id,
      orderId: orderI._id,
      razorpayOrderId: gatewayOrderI,
      amount: orderI.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptI._id);
    const amountMismatchEvent = await processSupportedWebhookEvent("payment.captured", {
      payload: {
        payment: {
          entity: {
            order_id: gatewayOrderI,
            id: `pay_capture_amount_mismatch_${Date.now()}`,
            amount: 99999,
            currency: "INR",
          },
        },
      },
    });
    check(
      amountMismatchEvent.outcome === "RECONCILIATION_REQUIRED" &&
        (await Order.findById(orderI._id))?.status === "PENDING" &&
        (await Order.findById(orderI._id))?.paymentStatus === "PENDING" &&
        (await Payment.findById(paymentI._id))?.status === "PENDING" &&
        (await PaymentAttempt.findById(attemptI._id))?.status === "PENDING",
      "4.11 paise amount mismatch requires reconciliation without applying capture"
    );

    const orderJ = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderJ._id);
    const paymentJ = await Payment.create({
      orderId: orderJ._id,
      userId,
      amount: orderJ.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentJ._id);
    const gatewayOrderJ = `order_capture_currency_mismatch_${Date.now()}`;
    const attemptJ = await PaymentAttempt.create({
      paymentId: paymentJ._id,
      orderId: orderJ._id,
      razorpayOrderId: gatewayOrderJ,
      amount: orderJ.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptJ._id);
    const currencyMismatchEvent = await processSupportedWebhookEvent("order.paid", {
      payload: {
        payment: {
          entity: {
            order_id: gatewayOrderJ,
            id: `pay_capture_currency_mismatch_${Date.now()}`,
            amount: 100000,
            currency: "USD",
          },
        },
      },
    });
    check(
      currencyMismatchEvent.outcome === "RECONCILIATION_REQUIRED" &&
        (await Order.findById(orderJ._id))?.status === "PENDING" &&
        (await Order.findById(orderJ._id))?.paymentStatus === "PENDING" &&
        (await Payment.findById(paymentJ._id))?.status === "PENDING" &&
        (await PaymentAttempt.findById(attemptJ._id))?.status === "PENDING",
      "4.12 currency mismatch requires reconciliation without applying capture"
    );

    const orderK = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderK._id);
    const gatewayOrderK = `order_capture_wrong_payment_${Date.now()}`;
    const attemptK = await PaymentAttempt.create({
      paymentId: paymentF._id,
      orderId: orderK._id,
      razorpayOrderId: gatewayOrderK,
      amount: orderK.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptK._id);
    const wrongPaymentCaptureId = `pay_capture_wrong_payment_${Date.now()}`;
    const identityMismatchEvent = await processSupportedWebhookEvent("payment.captured", {
      payload: {
        payment: {
          entity: {
            order_id: gatewayOrderK,
            id: wrongPaymentCaptureId,
            amount: 100000,
            currency: "INR",
          },
        },
      },
    });
    check(
      identityMismatchEvent.outcome === "RECONCILIATION_REQUIRED" &&
        (await Order.findById(orderK._id))?.status === "PENDING" &&
        (await Order.findById(orderK._id))?.paymentStatus === "PENDING" &&
        (await Payment.findById(paymentF._id))?.status === "PENDING" &&
        (await PaymentAttempt.findById(attemptK._id))?.status === "PENDING",
      "4.13 attempt linked to another order's Payment requires reconciliation without mutation"
    );
    const mismatchedProcessorCapture = await processPaymentSuccess(gatewayOrderK, wrongPaymentCaptureId);
    check(
      mismatchedProcessorCapture?.success === false &&
        mismatchedProcessorCapture.reason === "PAYMENT_RECONCILIATION_REQUIRED" &&
        (await Order.findById(orderK._id))?.paymentStatus === "PENDING" &&
        (await Payment.findById(paymentF._id))?.status === "PENDING" &&
        (await PaymentAttempt.findById(attemptK._id))?.status === "PENDING",
      "4.13a processor rejects a capture linked to a different Payment order"
    );

    const orderM = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderM._id);
    const gatewayOrderM = `order_capture_missing_payment_${Date.now()}`;
    const missingPaymentAttempt = await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: orderM._id,
      razorpayOrderId: gatewayOrderM,
      amount: orderM.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(missingPaymentAttempt._id);
    const missingLinkedPaymentEvent = await processSupportedWebhookEvent("payment.captured", {
      payload: {
        payment: {
          entity: {
            order_id: gatewayOrderM,
            id: `pay_capture_missing_payment_${Date.now()}`,
            amount: 100000,
            currency: "INR",
          },
        },
      },
    });
    check(
      missingLinkedPaymentEvent.outcome === "RECONCILIATION_REQUIRED" &&
        (await Order.findById(orderM._id))?.status === "PENDING" &&
        (await Order.findById(orderM._id))?.paymentStatus === "PENDING" &&
        (await PaymentAttempt.findById(missingPaymentAttempt._id))?.status === "PENDING" &&
        (await Payment.countDocuments({ orderId: orderM._id })) === 0,
      "4.14 capture with a missing linked Payment requires reconciliation without force-linking"
    );

    const orderN = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderN._id);
    const paymentN = await Payment.create({
      orderId: orderN._id,
      userId,
      amount: orderN.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentN._id);
    const attemptN = await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: orderN._id,
      razorpayOrderId: `order_capture_orphan_payment_id_${Date.now()}`,
      amount: orderN.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptN._id);
    const orphanPaymentIdCapture = await processPaymentSuccess(
      attemptN.razorpayOrderId,
      `pay_capture_orphan_payment_id_${Date.now()}`
    );
    check(
      orphanPaymentIdCapture?.success === false &&
        orphanPaymentIdCapture.reason === "PAYMENT_RECONCILIATION_REQUIRED" &&
        (await Order.findById(orderN._id))?.paymentStatus === "PENDING" &&
        (await Payment.findById(paymentN._id))?.status === "PENDING" &&
        (await Payment.countDocuments({ orderId: orderN._id })) === 1,
      "4.14a order-level Payment with a different id is preserved for reconciliation"
    );

    const orderL = await createOrderFixture({ userId, productId, variantId, quantity: 1, unitPrice: 1000 });
    orderIds.push(orderL._id);
    const paymentL = await Payment.create({
      orderId: orderL._id,
      userId,
      amount: orderL.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    paymentIds.push(paymentL._id);
    const gatewayOrderL = `order_failure_linked_${Date.now()}`;
    const failedEventPaymentId = `pay_failure_linked_${Date.now()}`;
    const attemptL = await PaymentAttempt.create({
      paymentId: paymentL._id,
      orderId: orderL._id,
      razorpayOrderId: gatewayOrderL,
      razorpayPaymentId: failedEventPaymentId,
      amount: orderL.total,
      currency: "INR",
      status: "PENDING",
    });
    attemptIds.push(attemptL._id);
    const mismatchedFailureEvent = await processSupportedWebhookEvent(
      "payment.failed",
      paymentFailureEvent(`other_gateway_order_${Date.now()}`, failedEventPaymentId, "GATEWAY_ERROR")
    );
    check(
      mismatchedFailureEvent.outcome === "RECONCILIATION_REQUIRED" &&
        (await PaymentAttempt.findById(attemptL._id))?.status === "PENDING" &&
        (await Payment.findById(paymentL._id))?.status === "PENDING" &&
        (await Order.findById(orderL._id))?.status === "PENDING" &&
        (await Order.findById(orderL._id))?.paymentStatus === "PENDING",
      "4.15 payment.failed with a conflicting gateway order preserves linked records"
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
    await Refund.deleteMany({ orderId: { $in: orderIds } }).catch(() => undefined);
    await DuplicateCaptureRefund.deleteMany({ paymentAttemptId: { $in: attemptIds } }).catch(() => undefined);
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
