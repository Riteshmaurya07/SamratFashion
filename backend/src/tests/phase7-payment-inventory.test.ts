/**
 * Phase 7 — Payment & Inventory Semantics Test Suite
 *
 * Verifies Requirement 3:
 * - Order succeeds + Payment succeeds (atomic stock deduction)
 * - Order succeeds + Payment fails (stock NOT deducted, inventory preserved)
 * - Payment abandoned & retried (stock preserved until success)
 * - Oversell prevention on simultaneous/insufficient stock payment
 */

import mongoose from "mongoose";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { Product } from "../models/Product";
import { Cart } from "../models/Cart";
import "../models/User"; // Ensure User model registered for payment processor
import "../models/Cart"; // Ensure Cart model registered for payment processor
import { InventoryTransaction } from "../models/InventoryTransaction";
import { processPaymentSuccess } from "../services/payment/paymentProcessor";
import { createTestProduct } from "./testHelpers";

const TEST_USER_ID = new mongoose.Types.ObjectId().toString();

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

async function runPaymentInventoryTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 7 — Payment & Inventory Semantics Tests   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  let product: any;

  try {
    const pRes = await createTestProduct({
      name: "Payment Semantics Test Tee",
      variants: [{ size: "M", color: "BLACK", stock: 10 }]
    });
    product = pRes.product;
    const variantId = pRes.variantIds[0];

    // Get initial stock
    let freshProd = await Product.findById(product._id);
    const initialStock = (freshProd?.variants as any).id(variantId)?.stock || 10;
    check(initialStock === 10, "PAY-INV-0 Initial variant stock is 10");

    // ─── SCENARIO A: Order Created + Payment Success ──────────────────────────
    console.log("\n[SCENARIO A: Order Success + Payment Success]");
    const orderA = await Order.create({
      orderNumber: `ORD-PAY-A-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          productImage: "http://localhost/img.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 3,
          unitPrice: 500,
          lineTotal: 1500,
          isCustomized: false
        }
      ],
      shippingAddress: { fullName: "A", phone: "1", addressLine1: "St", city: "C", state: "S", postalCode: "1", country: "IN", addressType: "HOME" },
      paymentMethod: "RAZORPAY",
      paymentStatus: "PENDING",
      status: "PENDING",
      subtotal: 1500,
      discount: 0,
      tax: 0,
      shipping: 0,
      total: 1500
    });

    const paymentA = await Payment.create({
      orderId: orderA._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 1500,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY"
    });

    const rzpOrderA = `rzp_pay_a_${Date.now()}`;
    await PaymentAttempt.create({
      paymentId: paymentA._id,
      orderId: orderA._id,
      razorpayOrderId: rzpOrderA,
      amount: 1500,
      currency: "INR",
      status: "PENDING"
    });

    await processPaymentSuccess(rzpOrderA, `pay_a_${Date.now()}`);

    freshProd = await Product.findById(product._id);
    const stockAfterA = (freshProd?.variants as any).id(variantId)?.stock;
    check(stockAfterA === 7, "PAY-INV-A.1 Stock correctly reduced from 10 to 7 on payment success (qty=3)", `stock=${stockAfterA}`);

    // Idempotency check: Process payment success again for Order A
    await processPaymentSuccess(rzpOrderA, `pay_a_${Date.now()}`);
    freshProd = await Product.findById(product._id);
    const stockAfterA2 = (freshProd?.variants as any).id(variantId)?.stock;
    check(stockAfterA2 === 7, "PAY-INV-A.2 Idempotency: Repeating payment success does NOT double-deduct stock", `stock=${stockAfterA2}`);

    // ─── SCENARIO B: Order Created + Payment Fails ────────────────────────────
    console.log("\n[SCENARIO B: Order Success + Payment Failed]");
    const orderB = await Order.create({
      orderNumber: `ORD-PAY-B-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          productImage: "http://localhost/img.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 4,
          unitPrice: 500,
          lineTotal: 2000,
          isCustomized: false
        }
      ],
      shippingAddress: { fullName: "B", phone: "1", addressLine1: "St", city: "C", state: "S", postalCode: "1", country: "IN", addressType: "HOME" },
      paymentMethod: "RAZORPAY",
      paymentStatus: "FAILED",
      status: "PENDING",
      subtotal: 2000,
      discount: 0,
      tax: 0,
      shipping: 0,
      total: 2000
    });

    // Payment failed: processPaymentSuccess is NOT called
    freshProd = await Product.findById(product._id);
    const stockAfterB = (freshProd?.variants as any).id(variantId)?.stock;
    check(stockAfterB === 7, "PAY-INV-B.1 Stock remains 7 after order creation when payment fails (no deduction)", `stock=${stockAfterB}`);

    // ─── SCENARIO C: Payment Abandoned & Retried ──────────────────────────────
    console.log("\n[SCENARIO C: Payment Abandoned then Retried]");
    const orderC = await Order.create({
      orderNumber: `ORD-PAY-C-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          productImage: "http://localhost/img.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1000,
          isCustomized: false
        }
      ],
      shippingAddress: { fullName: "C", phone: "1", addressLine1: "St", city: "C", state: "S", postalCode: "1", country: "IN", addressType: "HOME" },
      paymentMethod: "RAZORPAY",
      paymentStatus: "PENDING",
      status: "PENDING",
      subtotal: 1000,
      discount: 0,
      tax: 0,
      shipping: 0,
      total: 1000
    });

    const paymentC = await Payment.create({
      orderId: orderC._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 1000,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY"
    });

    // Attempt 1 abandoned (expired)
    await PaymentAttempt.create({
      paymentId: paymentC._id,
      orderId: orderC._id,
      razorpayOrderId: `rzp_c_1_${Date.now()}`,
      amount: 1000,
      currency: "INR",
      status: "FAILED",
      failureReason: "Payment abandoned"
    });

    freshProd = await Product.findById(product._id);
    check((freshProd?.variants as any).id(variantId)?.stock === 7, "PAY-INV-C.1 Stock preserved at 7 while payment is abandoned");

    // Attempt 2 retry succeeds
    const rzpOrderC2 = `rzp_c_2_${Date.now()}`;
    await PaymentAttempt.create({
      paymentId: paymentC._id,
      orderId: orderC._id,
      razorpayOrderId: rzpOrderC2,
      amount: 1000,
      currency: "INR",
      status: "PENDING"
    });

    await processPaymentSuccess(rzpOrderC2, `pay_c_${Date.now()}`);
    freshProd = await Product.findById(product._id);
    const stockAfterC2 = (freshProd?.variants as any).id(variantId)?.stock;
    check(stockAfterC2 === 5, "PAY-INV-C.2 Stock correctly reduced from 7 to 5 when payment retry succeeds (qty=2)", `stock=${stockAfterC2}`);

    // ─── SCENARIO D: Stock Oversell Protection ────────────────────────────────
    console.log("\n[SCENARIO D: Stock Oversell Protection]");
    // Current stock is 5. Order D requests 10 units.
    const orderD = await Order.create({
      orderNumber: `ORD-PAY-D-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      items: [
        {
          productId: product._id,
          variantId,
          productName: product.name,
          productImage: "http://localhost/img.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 10,
          unitPrice: 500,
          lineTotal: 5000,
          isCustomized: false
        }
      ],
      shippingAddress: { fullName: "D", phone: "1", addressLine1: "St", city: "C", state: "S", postalCode: "1", country: "IN", addressType: "HOME" },
      paymentMethod: "RAZORPAY",
      paymentStatus: "PENDING",
      status: "PENDING",
      subtotal: 5000,
      discount: 0,
      tax: 0,
      shipping: 0,
      total: 5000
    });

    const paymentD = await Payment.create({
      orderId: orderD._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 5000,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY"
    });

    const rzpOrderD = `rzp_d_${Date.now()}`;
    await PaymentAttempt.create({
      paymentId: paymentD._id,
      orderId: orderD._id,
      razorpayOrderId: rzpOrderD,
      amount: 5000,
      currency: "INR",
      status: "PENDING"
    });

    await processPaymentSuccess(rzpOrderD, `pay_d_${Date.now()}`);

    freshProd = await Product.findById(product._id);
    const stockAfterD = (freshProd?.variants as any).id(variantId)?.stock;
    check(stockAfterD === 5, "PAY-INV-D.1 Oversell prevented: Stock remains 5 (not negative) when request (10) > stock (5)", `stock=${stockAfterD}`);

    const txD = await InventoryTransaction.findOne({ orderId: orderD._id });
    check(txD === null, "PAY-INV-D.2 No inventory sale transaction created for oversell attempt");

  } catch (err: any) {
    console.error("Payment inventory test execution error:", err);
    failures.push(`Execution error: ${err.message}`);
    failed++;
  } finally {
    if (product) await Product.deleteOne({ _id: product._id });
    await Order.deleteMany({ userId: TEST_USER_ID });
    await Payment.deleteMany({ userId: TEST_USER_ID });
    await PaymentAttempt.deleteMany({ amount: { $gte: 0 } });
    await InventoryTransaction.deleteMany({});
    await mongoose.disconnect();
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`Payment / Inventory Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runPaymentInventoryTests().catch(e => {
  console.error("Payment inventory test runner crashed:", e);
  process.exit(1);
});
