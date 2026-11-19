/**
 * Safe One-Time Purge Script for Sensitive NotificationLog Records
 *
 * Remediates N-C1: Historical rows where NotificationLog.idempotencyKey contained
 * raw plaintext password-reset tokens or email verification tokens/OTPs.
 *
 * Usage (from the backend/ directory with MONGODB_URI set in backend/.env):
 *
 *   # 1. Dry run (default) — inspects matching rows, changes nothing:
 *   npx ts-node src/scripts/purgeSensitiveNotificationLogs.ts
 *   or:
 *   npm run purge:notification-tokens
 *
 *   # 2. Confirm execution — permanently purges matching rows:
 *   npx ts-node src/scripts/purgeSensitiveNotificationLogs.ts --confirm
 *   or:
 *   npm run purge:notification-tokens -- --confirm
 */

import dotenv from "dotenv";
import path from "path";
import mongoose from "mongoose";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { NotificationLog } from "../models/NotificationLog";

async function run(): Promise<void> {
  const isConfirm = process.argv.includes("--confirm");
  const mongoUri = process.env.MONGODB_URI || process.env.Mongodb_URI;

  if (!mongoUri) {
    console.error("FATAL: MONGODB_URI is not set in backend/.env or environment.");
    process.exit(1);
  }

  console.log("================================================================================");
  console.log("  NotificationLog Sensitive Token Purge Utility (N-C1 Remediation)");
  console.log("================================================================================");
  console.log(`Mode: ${isConfirm ? "CONFIRM (DELETION ENABLED)" : "DRY RUN (READ ONLY)"}`);

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.");

  // Target historical rows that embed plaintext tokens/OTPs in idempotencyKey
  const sensitiveQuery = {
    $or: [
      { idempotencyKey: { $regex: /^PASSWORD_RESET:/i } },
      { idempotencyKey: { $regex: /^EMAIL_VERIFICATION:/i } },
      { idempotencyKey: { $regex: /:[a-f0-9]{32,64}/i } },
      { eventType: { $in: ["PASSWORD_RESET_REQUESTED", "EMAIL_VERIFICATION"] } },
    ],
  };

  const count = await NotificationLog.countDocuments(sensitiveQuery);
  console.log(`Found ${count} historical NotificationLog record(s) matching sensitive criteria.`);

  if (count === 0) {
    console.log("No sensitive notification log records found. Database is already clean.");
    await mongoose.disconnect();
    return;
  }

  const sampleRows = await NotificationLog.find(sensitiveQuery)
    .limit(5)
    .select("_id eventType recipientEmail idempotencyKey createdAt")
    .lean();

  console.log("\nSample records identified for purge (masked):");
  sampleRows.forEach((row, i) => {
    const email = row.recipientEmail || "";
    const maskedEmail = email.includes("@")
      ? `${email.slice(0, 2)}***${email.slice(email.indexOf("@"))}`
      : "***";
    const maskedKey = row.idempotencyKey
      ? `${row.idempotencyKey.slice(0, 15)}...[REDACTED_TOKEN_MATERIAL]`
      : "n/a";
    console.log(`  [${i + 1}] ID: ${row._id} | Type: ${row.eventType} | Recipient: ${maskedEmail} | Key: ${maskedKey}`);
  });

  if (!isConfirm) {
    console.log("\n[DRY RUN COMPLETE] No records were deleted.");
    console.log("To execute the purge, re-run with the --confirm flag:");
    console.log("  npx ts-node src/scripts/purgeSensitiveNotificationLogs.ts --confirm\n");
  } else {
    console.log("\nExecuting purge of sensitive notification log records...");
    const deleteResult = await NotificationLog.deleteMany(sensitiveQuery);
    console.log(`[SUCCESS] Purged ${deleteResult.deletedCount} sensitive NotificationLog record(s).`);
  }

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

run().catch((err) => {
  console.error("Purge script failed with error:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
