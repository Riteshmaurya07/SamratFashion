import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb } from "./testHelpers";
import { WebhookEvent } from "../models/WebhookEvent";
import { LogisticsEventLog } from "../models/LogisticsEventLog";
import { NotificationLog } from "../models/NotificationLog";
import { AuditLog } from "../models/AuditLog";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { cleanupExpiredLogs } from "../services/logCleanupService";

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

async function runLogCleanupTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Automated Log Retention & Safe Cleanup Verification Suite    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);
    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const testActorId = new mongoose.Types.ObjectId();
    const testEntityId = new mongoose.Types.ObjectId();
    const testProductId = new mongoose.Types.ObjectId();
    const testVariantId = new mongoose.Types.ObjectId();

    console.log("[1. Setting up Test Log Fixtures]");

    // 1. WebhookEvent: 1 stale (130 days old), 1 fresh (10 days old)
    const staleWebhook = await WebhookEvent.create({
      eventId: `evt_stale_${now}`,
      provider: "RAZORPAY",
      eventType: "payment.captured",
      status: "PROCESSED",
      createdAt: new Date(now - 130 * MS_PER_DAY),
    });

    const freshWebhook = await WebhookEvent.create({
      eventId: `evt_fresh_${now}`,
      provider: "RAZORPAY",
      eventType: "payment.captured",
      status: "PROCESSED",
      createdAt: new Date(now - 10 * MS_PER_DAY),
    });

    // 2. LogisticsEventLog: 1 stale (140 days old), 1 fresh (5 days old)
    const staleLogistics = await LogisticsEventLog.create({
      providerEventId: `log_stale_${now}`,
      awbNumber: "AWB123456",
      eventType: "DELIVERED",
      createdAt: new Date(now - 140 * MS_PER_DAY),
    });

    const freshLogistics = await LogisticsEventLog.create({
      providerEventId: `log_fresh_${now}`,
      awbNumber: "AWB789012",
      eventType: "IN_TRANSIT",
      createdAt: new Date(now - 5 * MS_PER_DAY),
    });

    // 3. NotificationLog: 1 stale (150 days old), 1 fresh (20 days old)
    const staleNotification = await NotificationLog.create({
      eventType: "ORDER_CONFIRMATION",
      entityType: "ORDER",
      entityId: testEntityId,
      recipientEmail: "stale@example.com",
      channel: "EMAIL",
      status: "SENT",
      idempotencyKey: `notif_stale_${now}`,
      createdAt: new Date(now - 150 * MS_PER_DAY),
    });

    const freshNotification = await NotificationLog.create({
      eventType: "ORDER_CONFIRMATION",
      entityType: "ORDER",
      entityId: testEntityId,
      recipientEmail: "fresh@example.com",
      channel: "EMAIL",
      status: "SENT",
      idempotencyKey: `notif_fresh_${now}`,
      createdAt: new Date(now - 20 * MS_PER_DAY),
    });

    // 4. AuditLog: 1 stale (400 days old > 365), 1 fresh (100 days old)
    const staleAudit = await AuditLog.create({
      actorId: testActorId,
      actorRole: "ADMIN",
      action: "OLD_UPDATE",
      entityType: "PRODUCT",
      entityId: testEntityId,
      createdAt: new Date(now - 400 * MS_PER_DAY),
    });

    const freshAudit = await AuditLog.create({
      actorId: testActorId,
      actorRole: "ADMIN",
      action: "RECENT_UPDATE",
      entityType: "PRODUCT",
      entityId: testEntityId,
      createdAt: new Date(now - 100 * MS_PER_DAY),
    });

    // 5. Critical Ledgers: MUST NEVER BE DELETED
    const testInventoryTx = await InventoryTransaction.create({
      productId: testProductId,
      variantId: testVariantId,
      quantity: 50,
      type: "RESTOCK",
      reason: "Initial factory stock batch",
      createdAt: new Date(now - 200 * MS_PER_DAY), // 200 days old! Must NOT be deleted
    });

    const testPaymentAttempt = await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: testEntityId,
      razorpayOrderId: `order_rzp_${now}`,
      amount: 4999,
      currency: "INR",
      status: "CAPTURED",
      createdAt: new Date(now - 200 * MS_PER_DAY), // 200 days old! Must NOT be deleted
    });
    console.log("[2. Executing Automated Log Cleanup with 120-Day Retention]");
    const report = await cleanupExpiredLogs({ retentionDays: 120, auditRetentionDays: 365 });

    check(report.webhooksDeleted >= 1, "2.1 Purged stale webhook events (>120 days)");
    check(report.logisticsDeleted >= 1, "2.2 Purged stale logistics event logs (>120 days)");
    check(report.notificationsDeleted >= 1, "2.3 Purged stale notification logs (>120 days)");
    check(report.auditLogsDeleted >= 1, "2.4 Purged stale audit logs (>365 days)");

    console.log("[3. Verifying Fresh Operational Records are Preserved]");
    const loadedStaleWebhook = await WebhookEvent.findById(staleWebhook._id);
    const loadedFreshWebhook = await WebhookEvent.findById(freshWebhook._id);
    check(loadedStaleWebhook === null, "3.1 Stale webhook was deleted");
    check(loadedFreshWebhook !== null, "3.2 Fresh webhook is preserved");

    const loadedStaleLogistics = await LogisticsEventLog.findById(staleLogistics._id);
    const loadedFreshLogistics = await LogisticsEventLog.findById(freshLogistics._id);
    check(loadedStaleLogistics === null, "3.3 Stale logistics log was deleted");
    check(loadedFreshLogistics !== null, "3.4 Fresh logistics log is preserved");

    const loadedStaleNotif = await NotificationLog.findById(staleNotification._id);
    const loadedFreshNotif = await NotificationLog.findById(freshNotification._id);
    check(loadedStaleNotif === null, "3.5 Stale notification log was deleted");
    check(loadedFreshNotif !== null, "3.6 Fresh notification log is preserved");

    const loadedStaleAudit = await AuditLog.findById(staleAudit._id);
    const loadedFreshAudit = await AuditLog.findById(freshAudit._id);
    check(loadedStaleAudit === null, "3.7 Stale audit log (>365 days) was deleted");
    check(loadedFreshAudit !== null, "3.8 Fresh audit log (<365 days) is preserved");

    console.log("[4. Verifying Financial & Inventory Ledgers are Untouched]");
    const loadedInventoryTx = await InventoryTransaction.findById(testInventoryTx._id);
    check(loadedInventoryTx !== null, "4.1 Inventory transaction ledger was NOT deleted (Permanent)");

    const loadedPaymentAttempt = await PaymentAttempt.findById(testPaymentAttempt._id);
    check(loadedPaymentAttempt !== null, "4.2 Payment attempt record was NOT deleted (Permanent)");

    console.log("[5. Verifying MongoDB TTL Indexes on Schemas]");
    const webhookIndexes = WebhookEvent.schema.indexes();
    const hasWebhookTTL = webhookIndexes.some(
      ([idx, opts]) => idx.createdAt === 1 && opts?.expireAfterSeconds === 120 * 24 * 60 * 60
    );
    check(hasWebhookTTL, "5.1 WebhookEvent schema has 120-day TTL index on createdAt");

    const logisticsIndexes = LogisticsEventLog.schema.indexes();
    const hasLogisticsTTL = logisticsIndexes.some(
      ([idx, opts]) => idx.createdAt === 1 && opts?.expireAfterSeconds === 120 * 24 * 60 * 60
    );
    check(hasLogisticsTTL, "5.2 LogisticsEventLog schema has 120-day TTL index on createdAt");

    const notifIndexes = NotificationLog.schema.indexes();
    const hasNotifTTL = notifIndexes.some(
      ([idx, opts]) => idx.createdAt === 1 && opts?.expireAfterSeconds === 120 * 24 * 60 * 60
    );
    check(hasNotifTTL, "5.3 NotificationLog schema has 120-day TTL index on createdAt");

    const auditIndexes = AuditLog.schema.indexes();
    const hasAuditTTL = auditIndexes.some(
      ([idx, opts]) => idx.createdAt === 1 && opts?.expireAfterSeconds === 365 * 24 * 60 * 60
    );
    check(hasAuditTTL, "5.4 AuditLog schema has 365-day TTL index on createdAt");

    console.log("\n🧹 Cleaning up test fixtures from database...");
    await Promise.all([
      WebhookEvent.deleteMany({ _id: { $in: [staleWebhook._id, freshWebhook._id] } }),
      LogisticsEventLog.deleteMany({ _id: { $in: [staleLogistics._id, freshLogistics._id] } }),
      NotificationLog.deleteMany({ _id: { $in: [staleNotification._id, freshNotification._id] } }),
      AuditLog.deleteMany({ _id: { $in: [staleAudit._id, freshAudit._id] } }),
      InventoryTransaction.deleteOne({ _id: testInventoryTx._id }),
      PaymentAttempt.deleteOne({ _id: testPaymentAttempt._id }),
    ]);

    await mongoose.disconnect();
    console.log(" Disconnected from MongoDB\n");
  } catch (err) {
    console.error("Test execution failed:", err);
    failed++;
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runLogCleanupTests();
