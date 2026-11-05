import mongoose from "mongoose";
import { Request, Response } from "express";
import { connectSafeTestDb } from "./testHelpers";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { DuplicateCaptureRefund } from "../models/DuplicateCaptureRefund";
import { razorpayProvider, RazorpayOrderResult, RazorpayRefundResult } from "../services/payment/RazorpayProvider";
import { createPaymentOrder } from "../controllers/paymentController";
import { processPaymentSuccess } from "../services/payment/paymentProcessor";
import { handleRefundProcessedEntity, handleRefundFailedEntity } from "../controllers/webhookController";
import "../models/Cart";

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

function createMockOrder(userId: mongoose.Types.ObjectId, orderNumber: string, paymentStatus: "PENDING" | "PAID") {
  const productId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();
  return Order.create({
    orderNumber,
    userId,
    items: [{
      productId,
      variantId,
      productName: "Payment regression item",
      productImage: "https://example.com/item.jpg",
      selectedSize: "M",
      selectedColor: "BLACK",
      quantity: 1,
      unitPrice: 1000,
      lineTotal: 1000,
    }],
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
    subtotal: 1000,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1000,
    currency: "INR",
    status: paymentStatus === "PAID" ? "CONFIRMED" : "PENDING",
    paymentStatus,
  });
}

async function runTests(): Promise<void> {
  await connectSafeTestDb();
  const userId = new mongoose.Types.ObjectId();
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];
  const cleanupPaymentIds: mongoose.Types.ObjectId[] = [];
  const cleanupAttemptIds: mongoose.Types.ObjectId[] = [];
  const originalCreateOrder = razorpayProvider.createOrder;
  const originalCreateRefund = razorpayProvider.createRefund;

  try {
    let gatewayOrderCreates = 0;
    razorpayProvider.createOrder = async (amountInPaise): Promise<RazorpayOrderResult> => {
      gatewayOrderCreates++;
      return {
        id: `rzp-idempotency-${gatewayOrderCreates}`,
        entity: "order",
        amount: amountInPaise,
        amount_paid: 0,
        amount_due: amountInPaise,
        currency: "INR",
        status: "created",
        attempts: 0,
        created_at: Math.floor(Date.now() / 1000),
      };
    };

    const pendingOrder = await createMockOrder(userId, `PAY-IDEMPOTENCY-${Date.now()}`, "PENDING");
    cleanupOrderIds.push(pendingOrder._id);
    const pendingOrderPayment = await Payment.create({
      orderId: pendingOrder._id,
      userId,
      amount: pendingOrder.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });
    cleanupPaymentIds.push(pendingOrderPayment._id);

    const request = {
      user: { id: userId.toString() },
      body: { orderId: pendingOrder._id.toString() },
    } as unknown as Request;
    const firstResponse = { statusCode: 200, body: null as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
    const secondResponse = { statusCode: 200, body: null as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
    await createPaymentOrder(request, firstResponse as unknown as Response);
    await createPaymentOrder(request, secondResponse as unknown as Response);
    const activeAttempts = await PaymentAttempt.find({ orderId: pendingOrder._id, status: "PENDING" });
    cleanupAttemptIds.push(...activeAttempts.map(attempt => attempt._id));
    check(gatewayOrderCreates === 1 && activeAttempts.length === 1, "Repeated payment-order creation reuses one pending gateway attempt");

    const concurrentOrder = await createMockOrder(userId, `PAY-CONCURRENT-${Date.now()}`, "PENDING");
    cleanupOrderIds.push(concurrentOrder._id);
    const concurrentRequest = {
      user: { id: userId.toString() },
      body: { orderId: concurrentOrder._id.toString() },
    } as unknown as Request;
    const concurrentResponses = Array.from({ length: 2 }, () => ({
      statusCode: 200,
      body: null as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    }));
    await Promise.all(concurrentResponses.map(response =>
      createPaymentOrder(concurrentRequest, response as unknown as Response)
    ));
    const concurrentAttempts = await PaymentAttempt.find({ orderId: concurrentOrder._id });
    cleanupAttemptIds.push(...concurrentAttempts.map(attempt => attempt._id));
    check(
      gatewayOrderCreates === 2 && concurrentAttempts.length === 1,
      "Concurrent payment-order requests create at most one gateway attempt"
    );

    const paidOrder = await createMockOrder(userId, `PAY-DUPLICATE-${Date.now()}`, "PAID");
    cleanupOrderIds.push(paidOrder._id);
    const capturedPaymentId = `pay-primary-${Date.now()}`;
    const paidOrderPayment = await Payment.create({
      orderId: paidOrder._id,
      userId,
      amount: paidOrder.total,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: capturedPaymentId,
    });
    cleanupPaymentIds.push(paidOrderPayment._id);
    const duplicateAttempt = await PaymentAttempt.create({
      orderId: paidOrder._id,
      paymentId: paidOrderPayment._id,
      razorpayOrderId: `rzp-duplicate-${Date.now()}`,
      amount: paidOrder.total,
      currency: "INR",
      status: "PENDING",
    });
    cleanupAttemptIds.push(duplicateAttempt._id);

    let refundCalls = 0;
    razorpayProvider.createRefund = async (
      _paymentId,
      amount,
      _notes,
      idempotencyKey
    ): Promise<RazorpayRefundResult> => {
      refundCalls++;
      check(Boolean(idempotencyKey?.startsWith("duplicate_")) && amount === 100000, "Duplicate capture refund uses a stable idempotency key and full attempt amount");
      return {
        id: `rfnd-duplicate-${Date.now()}`,
        entity: "refund",
        amount,
        status: "processed",
      };
    };

    const duplicateResult = await processPaymentSuccess(duplicateAttempt.razorpayOrderId, `pay-duplicate-${Date.now()}`);
    const savedAttempt = await PaymentAttempt.findById(duplicateAttempt._id);
    check(duplicateResult?.success === true && savedAttempt?.failureCode === "DUPLICATE_CAPTURE_REFUNDED", "Extra capture is refunded and marked terminal");
    await processPaymentSuccess(duplicateAttempt.razorpayOrderId, savedAttempt?.razorpayPaymentId);
    check(refundCalls === 1, "Replayed capture does not submit a second refund");
    const duplicateRefundRecord = await DuplicateCaptureRefund.findOne({ paymentAttemptId: duplicateAttempt._id });
    const savedPayment = await Payment.findById(paidOrderPayment._id);
    check(
      duplicateRefundRecord?.status === "PROCESSED" &&
        Boolean(duplicateRefundRecord.razorpayRefundId) &&
        savedPayment?.reconciliationRequired === true,
      "Duplicate capture refund is separately ledgered and flags payment reconciliation"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TWO SEPARATELY CAPTURED PAYMENT ATTEMPTS TEST
    // ─────────────────────────────────────────────────────────────────────────────
    const twoCaptureOrder = await createMockOrder(userId, `PAY-TWO-CAPTURES-${Date.now()}`, "PAID");
    cleanupOrderIds.push(twoCaptureOrder._id);
    const twoCapturePrimaryPayment = await Payment.create({
      orderId: twoCaptureOrder._id,
      userId,
      amount: twoCaptureOrder.total,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay-primary-two-${Date.now()}`,
    });
    cleanupPaymentIds.push(twoCapturePrimaryPayment._id);

    const attemptA = await PaymentAttempt.create({
      orderId: twoCaptureOrder._id,
      paymentId: twoCapturePrimaryPayment._id,
      razorpayOrderId: `rzp-two-cap-a-${Date.now()}`,
      amount: twoCaptureOrder.total,
      currency: "INR",
      status: "PENDING",
    });
    cleanupAttemptIds.push(attemptA._id);

    const attemptB = await PaymentAttempt.create({
      orderId: twoCaptureOrder._id,
      paymentId: twoCapturePrimaryPayment._id,
      razorpayOrderId: `rzp-two-cap-b-${Date.now()}`,
      amount: twoCaptureOrder.total,
      currency: "INR",
      status: "PENDING",
    });
    cleanupAttemptIds.push(attemptB._id);

    const refundCallsByPaymentId: Record<string, number> = {};
    const refundKeysUsed: string[] = [];
    razorpayProvider.createRefund = async (
      paymentId,
      amount,
      _notes,
      idempotencyKey
    ): Promise<RazorpayRefundResult> => {
      refundCallsByPaymentId[paymentId] = (refundCallsByPaymentId[paymentId] || 0) + 1;
      if (idempotencyKey) refundKeysUsed.push(idempotencyKey);
      return {
        id: `rfnd-two-${paymentId}-${Date.now()}`,
        entity: "refund",
        amount,
        status: "processed",
      };
    };

    const captureIdA = `pay-cap-a-${Date.now()}`;
    const captureIdB = `pay-cap-b-${Date.now()}`;

    // Process first extra capture (attempt A)
    const resultA = await processPaymentSuccess(attemptA.razorpayOrderId, captureIdA);
    const savedAttemptA = await PaymentAttempt.findById(attemptA._id);
    const ledgerA = await DuplicateCaptureRefund.findOne({ paymentAttemptId: attemptA._id });

    // Process second extra capture (attempt B)
    const resultB = await processPaymentSuccess(attemptB.razorpayOrderId, captureIdB);
    const savedAttemptB = await PaymentAttempt.findById(attemptB._id);
    const ledgerB = await DuplicateCaptureRefund.findOne({ paymentAttemptId: attemptB._id });

    check(
      resultA?.success === true &&
        savedAttemptA?.failureCode === "DUPLICATE_CAPTURE_REFUNDED" &&
        ledgerA?.status === "PROCESSED" &&
        ledgerA?.capturePaymentId === captureIdA,
      "First captured attempt produces a correct processed refund ledger"
    );

    check(
      resultB?.success === true &&
        savedAttemptB?.failureCode === "DUPLICATE_CAPTURE_REFUNDED" &&
        ledgerB?.status === "PROCESSED" &&
        ledgerB?.capturePaymentId === captureIdB,
      "Second captured attempt produces an independent correct processed refund ledger"
    );

    check(
      ledgerA?._id.toString() !== ledgerB?._id.toString() &&
        refundCallsByPaymentId[captureIdA] === 1 &&
        refundCallsByPaymentId[captureIdB] === 1,
      "Two separately captured attempts trigger two distinct gateway refunds"
    );

    // Idempotent replays for both attempts
    const replayResultA = await processPaymentSuccess(attemptA.razorpayOrderId, captureIdA);
    const replayResultB = await processPaymentSuccess(attemptB.razorpayOrderId, captureIdB);

    check(
      replayResultA?.success === true &&
        replayResultB?.success === true &&
        refundCallsByPaymentId[captureIdA] === 1 &&
        refundCallsByPaymentId[captureIdB] === 1,
      "Replaying two separately captured payment attempts is strictly idempotent without extra refunds"
    );

    const pendingAttempt = await PaymentAttempt.create({
      orderId: paidOrder._id,
      paymentId: paidOrderPayment._id,
      razorpayOrderId: `rzp-duplicate-pending-${Date.now()}`,
      amount: paidOrder.total,
      currency: "INR",
      status: "PENDING",
    });
    cleanupAttemptIds.push(pendingAttempt._id);
    const pendingCaptureId = `pay-duplicate-pending-${Date.now()}`;
    const pendingRefundId = `rfnd-duplicate-pending-${Date.now()}`;
    razorpayProvider.createRefund = async (_paymentId, amount): Promise<RazorpayRefundResult> => ({
      id: pendingRefundId,
      entity: "refund",
      amount,
      status: "pending",
    });
    const pendingResult = await processPaymentSuccess(pendingAttempt.razorpayOrderId, pendingCaptureId);
    const pendingLedger = await DuplicateCaptureRefund.findOne({ paymentAttemptId: pendingAttempt._id });
    check(
      pendingResult?.reason === "DUPLICATE_CAPTURE_REFUND_PENDING" && pendingLedger?.status === "PENDING",
      "Pending duplicate refund is preserved for webhook completion"
    );
    const webhookResult = await handleRefundProcessedEntity({
      id: pendingRefundId,
      payment_id: pendingCaptureId,
      amount: 100000,
      currency: "INR",
      status: "processed",
      notes: { duplicate_capture_refund_id: pendingLedger!._id.toString() },
    });
    const processedPendingLedger = await DuplicateCaptureRefund.findOne({ paymentAttemptId: pendingAttempt._id });
    check(
      webhookResult.outcome === "PROCESSED" && processedPendingLedger?.status === "PROCESSED",
      "Refund webhook settles the separate duplicate-capture ledger"
    );

    const failedAttempt = await PaymentAttempt.create({
      orderId: paidOrder._id,
      paymentId: paidOrderPayment._id,
      razorpayOrderId: `rzp-duplicate-failed-${Date.now()}`,
      amount: paidOrder.total,
      currency: "INR",
      status: "PENDING",
    });
    cleanupAttemptIds.push(failedAttempt._id);
    const failedCaptureId = `pay-duplicate-failed-${Date.now()}`;
    const failedRefundId = `rfnd-duplicate-failed-${Date.now()}`;
    razorpayProvider.createRefund = async (_paymentId, amount): Promise<RazorpayRefundResult> => ({
      id: failedRefundId,
      entity: "refund",
      amount,
      status: "pending",
    });
    await processPaymentSuccess(failedAttempt.razorpayOrderId, failedCaptureId);
    const failedLedger = await DuplicateCaptureRefund.findOne({ paymentAttemptId: failedAttempt._id });
    const failedWebhookResult = await handleRefundFailedEntity({
      id: failedRefundId,
      payment_id: failedCaptureId,
      amount: 100000,
      currency: "INR",
      error_description: "Provider rejected duplicate refund",
      notes: { duplicate_capture_refund_id: failedLedger!._id.toString() },
    });
    const failedSavedLedger = await DuplicateCaptureRefund.findOne({ paymentAttemptId: failedAttempt._id });
    check(
      failedWebhookResult.outcome === "PROCESSED" && failedSavedLedger?.status === "FAILED",
      "Failed refund webhook is recorded against the duplicate-capture ledger"
    );

    const retryAttempt = await PaymentAttempt.create({
      orderId: paidOrder._id,
      paymentId: paidOrderPayment._id,
      razorpayOrderId: `rzp-duplicate-retry-${Date.now()}`,
      amount: paidOrder.total,
      currency: "INR",
      status: "PENDING",
    });
    cleanupAttemptIds.push(retryAttempt._id);
    let retryCalls = 0;
    razorpayProvider.createRefund = async (_paymentId, amount, _notes, idempotencyKey): Promise<RazorpayRefundResult> => {
      retryCalls++;
      check(Boolean(idempotencyKey?.startsWith("duplicate_")), "Duplicate refund retry preserves provider idempotency");
      if (retryCalls === 1) throw new Error("temporary gateway timeout");
      return {
        id: `rfnd-duplicate-retry-${Date.now()}`,
        entity: "refund",
        amount,
        status: "processed",
      };
    };
    const retryCaptureId = `pay-duplicate-retry-${Date.now()}`;
    const firstRetryResult = await processPaymentSuccess(retryAttempt.razorpayOrderId, retryCaptureId);
    const retryLedger = await DuplicateCaptureRefund.findOne({ paymentAttemptId: retryAttempt._id });
    const secondRetryResult = await processPaymentSuccess(retryAttempt.razorpayOrderId, retryCaptureId);
    const completedRetryLedger = await DuplicateCaptureRefund.findOne({ paymentAttemptId: retryAttempt._id });
    check(
      firstRetryResult?.reason === "DUPLICATE_CAPTURE_REFUND_UNKNOWN" &&
        retryLedger?.status === "UNKNOWN" &&
        secondRetryResult?.success === true &&
        completedRetryLedger?.status === "PROCESSED" &&
        retryCalls === 2,
      "Unknown duplicate refund outcome is retained and safely retried to settlement"
    );
  } finally {
    razorpayProvider.createOrder = originalCreateOrder;
    razorpayProvider.createRefund = originalCreateRefund;
    await PaymentAttempt.deleteMany({ $or: [{ _id: { $in: cleanupAttemptIds } }, { orderId: { $in: cleanupOrderIds } }] });
    await DuplicateCaptureRefund.deleteMany({ $or: [{ paymentAttemptId: { $in: cleanupAttemptIds } }, { orderId: { $in: cleanupOrderIds } }] });
    await Payment.deleteMany({ $or: [{ _id: { $in: cleanupPaymentIds } }, { orderId: { $in: cleanupOrderIds } }] });
    await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
    await mongoose.disconnect();
  }

  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(error => {
  console.error("Payment idempotency test failed:", error);
  process.exit(1);
});
