/**
 * Phase 6: Logistics State-Machine and Webhook Integrity Test Suite
 *
 * Verifies that:
 * 1. Webhook HMAC signatures are verified with constant-time comparison; invalid signatures fail with 400.
 * 2. Forward status transitions advance correctly and synchronize order state.
 * 3. Out-of-order late events cannot regress a DELIVERED shipment back to IN_TRANSIT or LABEL_CREATED.
 * 4. Unknown carrier scan codes are recorded in tracking history without inventing a fake state transition.
 * 5. Duplicate webhook deliveries are rejected idempotently.
 */

import mongoose from "mongoose";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb } from "./testHelpers";
import { Shipment, IShipment } from "../models/Shipment";
import { Order } from "../models/Order";
import { LogisticsEventLog } from "../models/LogisticsEventLog";
import { handleLogisticsWebhook } from "../controllers/logisticsWebhookController";
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

async function runLogisticsTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Logistics State-Machine & Webhook Integrity Verification Suite║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupShipmentIds: mongoose.Types.ObjectId[] = [];
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];
  const cleanupEventLogs: string[] = [];
  const origDelhiverySecret = process.env.DELHIVERY_WEBHOOK_SECRET;
  const origLogisticsSecret = process.env.LOGISTICS_WEBHOOK_SECRET;
  const webhookSecret = "test_logistics_webhook_secret_key_999";
  process.env.DELHIVERY_WEBHOOK_SECRET = webhookSecret;
  process.env.LOGISTICS_WEBHOOK_SECRET = webhookSecret;
  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

    const timestamp = Date.now();
    const awb = `AWB-${timestamp}`;

    const order = await Order.create({
      orderNumber: `ORD-LOG-${timestamp}`,
      userId: new mongoose.Types.ObjectId(),
      items: [],
      subtotal: 1500,
      total: 1500,
      status: "PROCESSING",
      paymentStatus: "PAID",
      shippingAddress: {
        fullName: "Test Customer",
        phone: "+919876500000",
        addressLine1: "123 High Street",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
    });
    cleanupOrderIds.push(order._id as mongoose.Types.ObjectId);

    const shipmentDoc = await Shipment.create({
      orderId: order._id as mongoose.Types.ObjectId,
      userId: order.userId as mongoose.Types.ObjectId,
      awbNumber: awb,
      trackingNumber: awb,
      carrier: "DELHIVERY",
      provider: "DELHIVERY",
      status: "LABEL_CREATED",
      createdBy: order.userId as mongoose.Types.ObjectId,
      updatedBy: order.userId as mongoose.Types.ObjectId,
      trackingHistory: [],
    });
    const shipment = shipmentDoc as unknown as IShipment;
    cleanupShipmentIds.push(shipment._id as mongoose.Types.ObjectId);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: SIGNATURE VERIFICATION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: WEBHOOK SIGNATURE VERIFICATION]");

    const validPayload = {
      awbNumber: awb,
      status: "IN_TRANSIT",
      location: "Bengaluru Hub",
      timestamp: Date.now(),
      providerEventId: `evt_trans_${timestamp}`,
    };
    const validRawBody = JSON.stringify(validPayload);
    const validSig = crypto.createHmac("sha256", webhookSecret).update(validRawBody).digest("hex");

    // 1.1: Forged signature rejected with 400
    let forgedError: any = null;
    const forgedReq = {
      headers: { "x-logistics-signature": "forged_hex_signature_000000000000000000000000000000000000000000000000" },
      body: validPayload,
    } as unknown as Request;
    const forgedRes = createMockRes();

    await handleLogisticsWebhook(forgedReq, forgedRes as unknown as Response, (err) => {
      forgedError = err;
    });
    check(
      forgedError !== null && forgedError.statusCode === 400,
      "1.1 Forged/invalid HMAC signature rejected with 400"
    );

    // 1.2: Valid signature succeeds
    const validReq = {
      headers: { "x-logistics-signature": validSig },
      body: validPayload,
    } as unknown as Request;
    const validRes = createMockRes();

    await handleLogisticsWebhook(validReq, validRes as unknown as Response, () => {});
    check(validRes.statusCode === 200, "1.2 Valid HMAC signature accepted with 200");
    cleanupEventLogs.push(validPayload.providerEventId);

    const reloadedShipment1 = await Shipment.findById(shipment._id);
    check(reloadedShipment1?.status === "IN_TRANSIT", "1.3 Shipment status advanced to IN_TRANSIT");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: TERMINAL STATUS PROTECTION (NO OUT-OF-ORDER REGRESSION)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: OUT-OF-ORDER REGRESSION PROTECTION]");

    // Advance to DELIVERED
    const deliveredPayload = {
      awbNumber: awb,
      status: "DELIVERED",
      location: "Customer Doorstep",
      timestamp: Date.now() + 1000,
      providerEventId: `evt_deliv_${timestamp}`,
    };
    const deliveredRaw = JSON.stringify(deliveredPayload);
    const deliveredSig = crypto.createHmac("sha256", webhookSecret).update(deliveredRaw).digest("hex");

    const deliveredReq = {
      headers: { "x-logistics-signature": deliveredSig },
      body: deliveredPayload,
    } as unknown as Request;
    const deliveredRes = createMockRes();

    await handleLogisticsWebhook(deliveredReq, deliveredRes as unknown as Response, () => {});
    cleanupEventLogs.push(deliveredPayload.providerEventId);

    const deliveredShipment = await Shipment.findById(shipment._id);
    check(deliveredShipment?.status === "DELIVERED", "2.1 Shipment advanced to DELIVERED");

    const deliveredOrder = await Order.findById(order._id);
    check(deliveredOrder?.status === "DELIVERED", "2.2 Order status synchronized to DELIVERED");

    // Now send a delayed out-of-order IN_TRANSIT or PICKED_UP event
    const delayedPayload = {
      awbNumber: awb,
      status: "PICKED_UP",
      location: "Warehouse Origin",
      timestamp: Date.now() + 2000,
      providerEventId: `evt_delayed_${timestamp}`,
    };
    const delayedRaw = JSON.stringify(delayedPayload);
    const delayedSig = crypto.createHmac("sha256", webhookSecret).update(delayedRaw).digest("hex");

    const delayedReq = {
      headers: { "x-logistics-signature": delayedSig },
      body: delayedPayload,
    } as unknown as Request;
    const delayedRes = createMockRes();

    await handleLogisticsWebhook(delayedReq, delayedRes as unknown as Response, () => {});
    cleanupEventLogs.push(delayedPayload.providerEventId);

    const reloadedAfterDelayed = await Shipment.findById(shipment._id);
    check(
      reloadedAfterDelayed?.status === "DELIVERED",
      "2.3 Late PICKED_UP event does NOT regress DELIVERED shipment back"
    );

    const reloadedOrderAfterDelayed = await Order.findById(order._id);
    check(
      reloadedOrderAfterDelayed?.status === "DELIVERED",
      "2.4 Order status remains DELIVERED (no order state regression)"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: UNKNOWN CARRIER STATUS HANDLING
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: UNKNOWN CARRIER STATUS]");

    // Setup fresh shipment in IN_TRANSIT
    const awb2 = `AWB-UNK-${timestamp}`;
    const order2 = await Order.create({
      orderNumber: `ORD-LOG2-${timestamp}`,
      userId: new mongoose.Types.ObjectId(),
      items: [],
      subtotal: 1000,
      total: 1000,
      status: "PROCESSING",
      paymentStatus: "PAID",
      shippingAddress: order.shippingAddress,
    });
    cleanupOrderIds.push(order2._id as mongoose.Types.ObjectId);

    const shipment2Doc = await Shipment.create({
      orderId: order2._id as mongoose.Types.ObjectId,
      userId: order2.userId as mongoose.Types.ObjectId,
      awbNumber: awb2,
      trackingNumber: awb2,
      carrier: "DELHIVERY",
      provider: "DELHIVERY",
      status: "IN_TRANSIT",
      createdBy: order2.userId as mongoose.Types.ObjectId,
      updatedBy: order2.userId as mongoose.Types.ObjectId,
      trackingHistory: [],
    });
    const shipment2 = shipment2Doc as unknown as IShipment;
    cleanupShipmentIds.push(shipment2._id as mongoose.Types.ObjectId);

    // Send unknown carrier status (e.g. CUSTOMS_HOLD_SCAN)
    const unknownPayload = {
      awbNumber: awb2,
      status: "CUSTOMS_HOLD_SCAN_UNKNOWN",
      location: "Border Checkpoint",
      timestamp: Date.now(),
      providerEventId: `evt_unk_${timestamp}`,
    };
    const unknownRaw = JSON.stringify(unknownPayload);
    const unknownSig = crypto.createHmac("sha256", webhookSecret).update(unknownRaw).digest("hex");

    const unknownReq = {
      headers: { "x-logistics-signature": unknownSig },
      body: unknownPayload,
    } as unknown as Request;
    const unknownRes = createMockRes();

    await handleLogisticsWebhook(unknownReq, unknownRes as unknown as Response, () => {});
    cleanupEventLogs.push(unknownPayload.providerEventId);

    const reloadedShipment2 = await Shipment.findById(shipment2._id);
    check(
      reloadedShipment2?.status === "IN_TRANSIT",
      "3.1 Unknown carrier status does NOT reset shipment to LABEL_CREATED (preserves IN_TRANSIT)"
    );
    check(
      reloadedShipment2?.trackingHistory.some((h) => h.description?.includes("CUSTOMS_HOLD_SCAN_UNKNOWN")) === true,
      "3.2 Unknown scan details recorded in trackingHistory for operational visibility"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: EVENT IDEMPOTENCY
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: DUPLICATE WEBHOOK IDEMPOTENCY]");

    // Replay identical delivered event
    const dupRes = createMockRes();
    await handleLogisticsWebhook(deliveredReq, dupRes as unknown as Response, () => {});
    check(
      dupRes.statusCode === 200 && Boolean(dupRes.data?.message?.includes("idempotent duplicate")),
      "4.1 Duplicate event recognized and returned with idempotent success"
    );

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (cleanupShipmentIds.length > 0) {
      await Shipment.deleteMany({ _id: { $in: cleanupShipmentIds } });
    }
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
    }
    if (cleanupEventLogs.length > 0) {
      await LogisticsEventLog.deleteMany({ providerEventId: { $in: cleanupEventLogs } });
    }
    process.env.DELHIVERY_WEBHOOK_SECRET = origDelhiverySecret;
    process.env.LOGISTICS_WEBHOOK_SECRET = origLogisticsSecret;
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

runLogisticsTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
