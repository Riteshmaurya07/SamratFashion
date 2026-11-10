import mongoose from "mongoose";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { AuditLog } from "../models/AuditLog";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { Product } from "../models/Product";
import { cancelOrderItemsWithRefund } from "../services/orderCancellationService";
import { razorpayProvider } from "../services/payment/RazorpayProvider";
import { TEST_CATEGORY_ID } from "./testHelpers";

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

async function runReplicaSetTransactionTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Section 1: MongoDB Replica-Set Transaction Verification Suite ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  const testUri = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27019/samrat_fashion_test_isolated?replicaSet=rsTest&directConnection=true";
  await mongoose.connect(testUri);
  console.log("Connected to Replica Set at:", testUri);

  const testSuffix = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const dummyUserId = new mongoose.Types.ObjectId();

  // Pre-create collections and await background index builds to complete before starting multi-document transactions
  await Promise.all([
    Order.init(),
    AuditLog.init(),
    Payment.init(),
    Product.init(),
    InventoryTransaction.init(),
  ]);
  try {
    // Group 1: Basic Multi-Document Transaction Commit & Rollback
    console.log("\n[TX GROUP 1: Multi-Document Transaction Commit & Rollback]");
    const session1 = await mongoose.startSession();
    session1.startTransaction();
    const orderNum1 = `TX-ORD-${testSuffix}-1`;
    await Order.create(
      [
        {
          orderNumber: orderNum1,
          userId: dummyUserId,
          items: [],
          shippingAddress: { fullName: "Test", phone: "9999999999", addressLine1: "A", city: "C", state: "S", postalCode: "000000", country: "India", addressType: "HOME" },
          subtotal: 100,
          discount: 0,
          shipping: 0,
          tax: 0,
          total: 100,
          currency: "INR",
          status: "PENDING",
          paymentStatus: "PAID",
        },
      ],
      { session: session1 }
    );
    await AuditLog.create(
      [
        {
          actorId: dummyUserId,
          actorRole: "ADMIN",
          action: "TX_TEST_ACTION",
          entityType: "ORDER",
          entityId: new mongoose.Types.ObjectId(),
        },
      ],
      { session: session1 }
    );
    await session1.commitTransaction();
    session1.endSession();

    const committedOrder = await Order.findOne({ orderNumber: orderNum1 });
    check(Boolean(committedOrder), "1.1 Multi-document transaction committed successfully");

    // Rollback test
    const session2 = await mongoose.startSession();
    session2.startTransaction();
    const orderNum2 = `TX-ORD-${testSuffix}-2`;
    await Order.create(
      [
        {
          orderNumber: orderNum2,
          userId: dummyUserId,
          items: [],
          shippingAddress: { fullName: "Test", phone: "9999999999", addressLine1: "A", city: "C", state: "S", postalCode: "000000", country: "India", addressType: "HOME" },
          subtotal: 100,
          discount: 0,
          shipping: 0,
          tax: 0,
          total: 100,
          currency: "INR",
          status: "PENDING",
          paymentStatus: "PAID",
        },
      ],
      { session: session2 }
    );
    await session2.abortTransaction();
    session2.endSession();

    const rolledBackOrder = await Order.findOne({ orderNumber: orderNum2 });
    check(rolledBackOrder === null, "1.2 Multi-document transaction rollback aborted all writes");

    // Group 2: Failure Injection During Multi-Step Order Operation
    console.log("\n[TX GROUP 2: Failure Injection During Multi-Step Operation]");
    const session3 = await mongoose.startSession();
    session3.startTransaction();
    let txFailedAsExpected = false;
    try {
      const orderNum3 = `TX-ORD-${testSuffix}-3`;
      await Order.create(
        [
          {
            orderNumber: orderNum3,
            userId: dummyUserId,
            items: [],
            shippingAddress: { fullName: "Test", phone: "9999999999", addressLine1: "A", city: "C", state: "S", postalCode: "000000", country: "India", addressType: "HOME" },
            subtotal: 100,
            discount: 0,
            shipping: 0,
            tax: 0,
            total: 100,
            currency: "INR",
            status: "PENDING",
            paymentStatus: "PAID",
          },
        ],
        { session: session3 }
      );
      // Injected failure
      throw new Error("Simulated transient step failure before commit");
    } catch (err: any) {
      if (err.message.includes("Simulated transient step failure")) {
        txFailedAsExpected = true;
      }
      await session3.abortTransaction();
    } finally {
      session3.endSession();
    }
    check(txFailedAsExpected, "2.1 Failure injected and caught");
    const injectedOrder = await Order.findOne({ orderNumber: `TX-ORD-${testSuffix}-3` });
    check(injectedOrder === null, "2.2 Injected failure left no orphaned order document");

    // Group 3: Order, Payment & Refund Ledger Consistency
    console.log("\n[TX GROUP 3: Payment & Refund Ledger Transaction Consistency]");
    const prodTx = await Product.create({
      name: "TX Consistency Product",
      slug: `tx-prod-${testSuffix}`,
      description: "Testing ledger consistency",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 500,
      freeDelivery: true,
      variants: [{ _id: new mongoose.Types.ObjectId(), sku: `SKU-TX-${testSuffix}`, size: "M", color: "BLACK", stock: 10 }],
    });

    const orderTx = await Order.create({
      orderNumber: `TX-ORD-${testSuffix}-LEDGER`,
      userId: dummyUserId,
      items: [
        {
          _id: new mongoose.Types.ObjectId(),
          productId: prodTx._id,
          variantId: prodTx.variants[0]._id,
          productName: prodTx.name,
          productImage: "https://example.com/tx.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1000,
          cancelledQuantity: 0,
        },
      ],
      shippingAddress: { fullName: "Ledger Test", phone: "9999999999", addressLine1: "A", city: "C", state: "S", postalCode: "000000", country: "India", addressType: "HOME" },
      subtotal: 1000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1000,
      initialSubtotal: 1000,
      initialDiscount: 0,
      initialShipping: 0,
      initialTotal: 1000,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      cancellationVersion: 0,
      cancellationOperations: [],
    });

    const paymentTx = await Payment.create({
      orderId: orderTx._id,
      userId: dummyUserId,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_tx_${testSuffix}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    check(Boolean(paymentTx), "Payment fixture created");
    await PaymentAttempt.create({
      paymentId: paymentTx._id,
      orderId: orderTx._id,
      razorpayOrderId: `order_tx_${Date.now()}`,
      razorpayPaymentId: paymentTx.razorpayPaymentId,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
    });

    // Mock Razorpay provider to simulate atomic gateway response
    const origCreateRefund = razorpayProvider.createRefund;
    razorpayProvider.createRefund = async (paymentId, amountInPaise, notes, idempKey) => {
      return {
        id: `rfnd_mock_tx_${Date.now()}`,
        entity: "refund",
        amount: amountInPaise,
        status: "processed",
        notes,
      };
    };

    // Cancel 1 item (₹500)
    const cancelOutcome = await cancelOrderItemsWithRefund({
      orderId: orderTx._id.toString(),
      items: [{ itemId: (orderTx.items[0]._id as mongoose.Types.ObjectId).toString(), quantity: 1 }],
      source: "CUSTOMER",
      reason: "Transaction ledger test cancellation",
    });

    check(cancelOutcome.refundAmount === 500, "3.1 Refund amount is exactly ₹500");
    const orderAfterCancel = await Order.findById(orderTx._id);
    check(orderAfterCancel?.total === 500, "3.2 Remaining active order total updated to ₹500");
    check(orderAfterCancel?.initialTotal === 1000, "3.3 Immutable initialTotal preserved at ₹1000");

    // Inventory Restoration Consistency
    const prodAfter = await Product.findById(prodTx._id);
    const restoredStock = prodAfter?.variants.find((v) => v._id && v._id.toString() === (prodTx.variants[0]._id as mongoose.Types.ObjectId).toString())?.stock;
    check(restoredStock === 11, "3.4 Stock restored atomically (10 -> 11)");

    const invTx = await InventoryTransaction.findOne({ orderId: orderTx._id, type: "RESTOCK" });
    check(Boolean(invTx), "3.5 InventoryTransaction record created with type RESTOCK");
    check(invTx?.quantity === 1, "3.6 InventoryTransaction restored quantity is 1");

    // Group 4: Concurrent Order Status Updates with Optimistic Locking
    console.log("\n[TX GROUP 4: Concurrent Status Updates with Optimistic Concurrency]");
    const orderConcurrent = await Order.create({
      orderNumber: `TX-ORD-${testSuffix}-CONCURRENT`,
      userId: dummyUserId,
      items: orderTx.items,
      shippingAddress: orderTx.shippingAddress,
      subtotal: 500,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 500,
      currency: "INR",
      status: "PENDING",
      paymentStatus: "PAID",
      cancellationVersion: 0,
    });

    // Two concurrent check-and-set writes on status
    const [w1, w2] = await Promise.all([
      Order.findOneAndUpdate(
        { _id: orderConcurrent._id, status: "PENDING" },
        { $set: { status: "CONFIRMED", updatedAt: new Date() } },
        { returnDocument: "after" }
      ),
      Order.findOneAndUpdate(
        { _id: orderConcurrent._id, status: "PENDING" },
        { $set: { status: "CONFIRMED", updatedAt: new Date() } },
        { returnDocument: "after" }
      ),
    ]);

    const winnerCount = (w1 ? 1 : 0) + (w2 ? 1 : 0);
    check(winnerCount === 1, "4.1 Exactly one concurrent transition won atomic condition (1 success, 1 null)");

    razorpayProvider.createRefund = origCreateRefund;
  } finally {
    await mongoose.disconnect();
  }

  console.log(`\nReplica Set Transaction Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runReplicaSetTransactionTests().catch((err) => {
  console.error("Replica Set test execution failed:", err);
  process.exit(1);
});
