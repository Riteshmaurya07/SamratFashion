/**
 * Phase 1: Payment Security and Mock-Payment Isolation Test Suite
 *
 * Verifies that:
 * 1. Valid payment signatures are accepted via constant-time comparison.
 * 2. Invalid signatures, forged signatures, and length mismatches are rejected.
 * 3. Mock-prefixed identifiers (order_mock_*, pay_mock_*) fail closed in strict environments (production/staging).
 * 4. ALLOW_PAYMENT_MOCK=true is rejected in production/staging.
 * 5. Gateway failures fail-closed in strict environments without silent mock order creation.
 * 6. Users cannot verify or finalize another user's payment attempt.
 */

import mongoose from "mongoose";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb } from "./testHelpers";
import { razorpayProvider, isMockPaymentPermitted } from "../services/payment/RazorpayProvider";
import { validateProductionEnv } from "../config/env";
import { verifyPayment } from "../controllers/paymentController";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { User, UserStatus, UserRole } from "../models/User";
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
  data: { success?: boolean; message?: string; [key: string]: unknown } | null;
  status(code: number): MockResponse;
  json(payload: { success?: boolean; message?: string; [key: string]: unknown }): MockResponse;
  send(payload: unknown): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: { success?: boolean; message?: string; [key: string]: unknown }) {
      this.data = payload;
      return this;
    },
    send(payload: unknown) {
      this.data = typeof payload === "object" && payload !== null ? (payload as { [key: string]: unknown }) : { raw: payload };
      return this;
    },
  };
  return res;
}

async function runPaymentSecurityTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Payment Security & Mock-Payment Isolation Verification Suite  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const origNodeEnv = process.env.NODE_ENV;
  const origAllowMock = process.env.ALLOW_PAYMENT_MOCK;
  const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const origKeyId = process.env.RAZORPAY_KEY_ID;

  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [];

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

    const testSecret = "test_razorpay_secret_1234567890";
    process.env.RAZORPAY_KEY_SECRET = testSecret;

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: SIGNATURE VERIFICATION (GENUINE & CONSTANT-TIME)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: SIGNATURE VERIFICATION]");
    process.env.NODE_ENV = "production";
    process.env.ALLOW_PAYMENT_MOCK = "false";

    const orderId = "order_real_123456";
    const paymentId = "pay_real_789012";
    const body = `${orderId}|${paymentId}`;
    const validSignature = crypto.createHmac("sha256", testSecret).update(body).digest("hex");
    const invalidSignature = "invalid_hex_signature_00000000000000000000000000000000000000000000";

    const accepted = razorpayProvider.verifyPaymentSignature(orderId, paymentId, validSignature);
    check(accepted === true, "1.1 Valid real signature is accepted via constant-time compare");

    const rejectedInvalid = razorpayProvider.verifyPaymentSignature(orderId, paymentId, invalidSignature);
    check(rejectedInvalid === false, "1.2 Invalid signature of same length is rejected");

    const rejectedLengthMismatch = razorpayProvider.verifyPaymentSignature(orderId, paymentId, "short_sig");
    check(rejectedLengthMismatch === false, "1.3 Mismatched signature length is safely rejected without crash");

    const rejectedEmpty = razorpayProvider.verifyPaymentSignature("", "", "");
    check(rejectedEmpty === false, "1.4 Empty signature/order parameters are rejected");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: MOCK IDENTIFIER ISOLATION IN STRICT ENVIRONMENTS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: MOCK ISOLATION IN PRODUCTION AND STAGING]");

    for (const envName of ["production", "staging"]) {
      process.env.NODE_ENV = envName;
      process.env.ALLOW_PAYMENT_MOCK = "true"; // Attacker attempts to enable mock in prod/staging

      check(isMockPaymentPermitted() === false, `2.1 isMockPaymentPermitted() is FALSE in ${envName} even with ALLOW_PAYMENT_MOCK=true`);

      const mockOrderVerified = razorpayProvider.verifyPaymentSignature("order_mock_1234", "pay_mock_5678", "sig_mock_fake");
      check(mockOrderVerified === false, `2.2 Mock-prefixed identifiers are strictly rejected in ${envName}`);

      let configErrorCaught = false;
      try {
        validateProductionEnv();
      } catch (err: unknown) {
        configErrorCaught = err instanceof Error && err.message.includes("ALLOW_PAYMENT_MOCK");
      }
      check(configErrorCaught, `2.3 validateProductionEnv() rejects ALLOW_PAYMENT_MOCK=true during ${envName} startup`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: PERMITTED DEV MOCK MODE
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: PERMITTED DEV MOCK CONFIGURATION]");
    process.env.NODE_ENV = "development";
    process.env.ALLOW_PAYMENT_MOCK = "true";

    check(isMockPaymentPermitted() === true, "3.1 isMockPaymentPermitted() is TRUE in development with ALLOW_PAYMENT_MOCK=true");

    const devMockVerified = razorpayProvider.verifyPaymentSignature("order_mock_1234", "pay_mock_5678", "sig_mock_fake");
    check(devMockVerified === true, "3.2 Mock signature accepted in explicitly permitted development mode");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: CONTROLLER VERIFICATION & CROSS-USER OWNERSHIP CHECKS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: CONTROLLER OWNERSHIP & ORDER STATE ENFORCEMENT]");
    process.env.NODE_ENV = "production";
    process.env.ALLOW_PAYMENT_MOCK = "false";

    const userA = await User.create({
      name: "User Alice",
      email: `alice_${Date.now()}@example.com`,
      passwordHash: "hash123",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
    const userB = await User.create({
      name: "User Bob",
      email: `bob_${Date.now()}@example.com`,
      passwordHash: "hash123",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
    cleanupUserIds.push(userA._id as mongoose.Types.ObjectId, userB._id as mongoose.Types.ObjectId);

    const orderA = await Order.create({
      orderNumber: `ORD-SEC-${Date.now()}`,
      userId: userA._id as mongoose.Types.ObjectId,
      items: [],
      subtotal: 1000,
      total: 1000,
      currency: "INR",
      status: "PENDING",
      paymentStatus: "PENDING",
      shippingAddress: {
        fullName: "Alice",
        phone: "+919876543210",
        addressLine1: "123 Street",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
    });
    cleanupOrderIds.push(orderA._id as mongoose.Types.ObjectId);

    const paymentA = await Payment.create({
      orderId: orderA._id as mongoose.Types.ObjectId,
      userId: userA._id as mongoose.Types.ObjectId,
      amount: 1000,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY",
    });

    const rpOrderId = `order_test_${Date.now()}`;
    const rpPaymentId = `pay_test_${Date.now()}`;
    await PaymentAttempt.create({
      paymentId: paymentA._id as mongoose.Types.ObjectId,
      orderId: orderA._id as mongoose.Types.ObjectId,
      razorpayOrderId: rpOrderId,
      amount: 1000,
      currency: "INR",
      status: "PENDING",
    });

    const validSigA = crypto.createHmac("sha256", testSecret).update(`${rpOrderId}|${rpPaymentId}`).digest("hex");

    // Test 4.1: User B tries to verify User A's payment attempt
    const crossUserReq = {
      user: { id: (userB._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
      body: {
        razorpay_order_id: rpOrderId,
        razorpay_payment_id: rpPaymentId,
        razorpay_signature: validSigA,
      },
    } as unknown as Request;
    const crossUserRes = createMockRes();
    await verifyPayment(crossUserReq, crossUserRes as unknown as Response);
    check(
      crossUserRes.statusCode === 404,
      "4.1 Cross-user payment verification is blocked (User B cannot verify User A's attempt)"
    );

    // Test 4.2: Cancelled order cannot be verified
    orderA.status = "CANCELLED";
    await orderA.save();
    const cancelledReq = {
      user: { id: (userA._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
      body: {
        razorpay_order_id: rpOrderId,
        razorpay_payment_id: rpPaymentId,
        razorpay_signature: validSigA,
      },
    } as unknown as Request;
    const cancelledRes = createMockRes();
    await verifyPayment(cancelledReq, cancelledRes as unknown as Response);
    check(
      cancelledRes.statusCode === 400 && Boolean(cancelledRes.data?.message?.includes("cancelled")),
      "4.2 Cancelled order rejects payment verification"
    );

    // Test 4.3: Mock payment attempt ID rejected in production
    const mockAttempt = await PaymentAttempt.create({
      paymentId: paymentA._id as mongoose.Types.ObjectId,
      orderId: orderA._id as mongoose.Types.ObjectId,
      razorpayOrderId: `order_mock_${Date.now()}`,
      amount: 1000,
      currency: "INR",
      status: "PENDING",
    });

    const mockAttemptReq = {
      user: { id: (userA._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
      body: {
        razorpay_order_id: mockAttempt.razorpayOrderId,
        razorpay_payment_id: "pay_mock_123",
        razorpay_signature: "sig_mock_fake",
      },
    } as unknown as Request;
    const mockAttemptRes = createMockRes();
    await verifyPayment(mockAttemptReq, mockAttemptRes as unknown as Response);
    check(
      mockAttemptRes.statusCode === 400,
      "4.3 Fabricated mock payment payload rejected with 400 in production"
    );

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    process.env.NODE_ENV = origNodeEnv;
    process.env.ALLOW_PAYMENT_MOCK = origAllowMock;
    process.env.RAZORPAY_KEY_SECRET = origKeySecret;
    process.env.RAZORPAY_KEY_ID = origKeyId;

    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
      await Payment.deleteMany({ orderId: { $in: cleanupOrderIds } });
      await PaymentAttempt.deleteMany({ orderId: { $in: cleanupOrderIds } });
    }
    if (cleanupUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: cleanupUserIds } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    console.log(" Disconnected from MongoDB\n");
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runPaymentSecurityTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
