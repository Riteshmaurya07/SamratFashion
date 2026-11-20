import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";

/**
 * PRODUCTION DATABASE WIPE SCRIPT (OWNER-RUN ONLY)
 *
 * Keeps 7 core operational collections:
 *  - products
 *  - users
 *  - categories
 *  - themes
 *  - storesettings
 *  - counters
 *  - addresses
 *
 * Wipes 38 transactional / ephemeral / test collections (orders, payments,
 * sessions, audit logs, notifications, tickets, coupons, etc.).
 *
 * SAFETY GUARDS:
 * 1. Requires explicit `--confirm` flag to execute deletions.
 * 2. Without `--confirm`, runs in DRY-RUN mode reporting document counts.
 * 3. Validates every existing collection in the database against the KEEP and DELETE
 *    allow-lists. Unknown collections abort execution immediately.
 */

export const KEEP_COLLECTIONS = new Set([
  "products",
  "users",
  "categories",
  "themes",
  "storesettings",
  "counters",
  "addresses",
]);

export const DELETE_COLLECTIONS = new Set([
  "orders",
  "payments",
  "paymentattempts",
  "duplicatecapturerefunds",
  "refunds",
  "returnrequests",
  "reverseshipments",
  "inventorytransactions",
  "stockreservations",
  "webhookevents",
  "notificationlogs",
  "invoices",
  "creditnotes",
  "coupons",
  "couponusages",
  "contentbanners",
  "campaigns",
  "reviews",
  "supporttickets",
  "carts",
  "wishlists",
  "sessions",
  "emailverificationtokens",
  "passwordresettokens",
  "auditlogs",
  "bulkorderrequests",
  "bulkquotes",
  "courierquotes",
  "customdesigns",
  "customdesignassets",
  "customprintcatalogitems",
  "customtemplates",
  "fulfillments",
  "logisticseventlogs",
  "printjobs",
  "printpricingconfigs",
  "recoverystatuses",
  "shipments",
  "workerlocks",
]);

async function main(): Promise<void> {
  const isConfirm = process.argv.includes("--confirm");
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.error("FATAL: MONGODB_URI is not set in environment.");
    process.exit(1);
  }

  console.log("=================================================================");
  console.log("       SAMRAT FASHION — DATABASE WIPE & RESET SCRIPT            ");
  console.log("=================================================================");
  console.log(`Mode: ${isConfirm ? "LIVE EXECUTION (--confirm)" : "DRY RUN (read-only)"}\n`);

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  if (!db) {
    console.error("FATAL: Unable to access MongoDB database instance.");
    process.exit(1);
  }

  const existingCollections = await db.listCollections().toArray();
  const existingNames = existingCollections.map((c) => c.name);

  console.log(`Found ${existingNames.length} existing collections in target database.\n`);

  // Verify unknown collections
  const unknownCollections: string[] = [];
  for (const name of existingNames) {
    if (name.startsWith("system.")) continue;
    if (!KEEP_COLLECTIONS.has(name) && !DELETE_COLLECTIONS.has(name)) {
      unknownCollections.push(name);
    }
  }

  if (unknownCollections.length > 0) {
    console.error("FATAL: Found unknown collection(s) neither in KEEP nor DELETE list:");
    for (const u of unknownCollections) {
      console.error(`  - ${u}`);
    }
    console.error("Aborting to prevent unintentional data loss or missed cleanup.");
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log("--- KEEP COLLECTIONS (7 collections preserved) ---");
  for (const name of KEEP_COLLECTIONS) {
    if (existingNames.includes(name)) {
      const count = await db.collection(name).countDocuments();
      console.log(`  [KEEP] ${name.padEnd(25)} : ${count} documents`);
    } else {
      console.log(`  [KEEP] ${name.padEnd(25)} : (collection not yet created)`);
    }
  }

  console.log("\n--- DELETE COLLECTIONS (wiped on --confirm) ---");
  let totalDeletedCandidates = 0;
  for (const name of DELETE_COLLECTIONS) {
    if (existingNames.includes(name)) {
      const count = await db.collection(name).countDocuments();
      totalDeletedCandidates += count;
      console.log(`  [${isConfirm ? "DELETE" : "DRY-RUN"}] ${name.padEnd(25)} : ${count} documents`);

      if (isConfirm && count > 0) {
        await db.collection(name).deleteMany({});
      }
    }
  }

  console.log("\n=================================================================");
  if (!isConfirm) {
    console.log(`DRY-RUN COMPLETED: ${totalDeletedCandidates} total documents in ${DELETE_COLLECTIONS.size} collections would be deleted.`);
    console.log("No data was modified. To execute deletions, run:");
    console.log("  npm run db:clear -- --confirm");
  } else {
    console.log(`WIPE COMPLETED: Successfully cleared documents from target collections.`);
    console.log("Core collections (products, users, categories, themes, storesettings, counters, addresses) remain intact.");
    console.log("All sessions deleted (users will need to log in again).");
    console.log("All notification logs deleted (N-C1 purge script is superseded).");
  }
  console.log("=================================================================\n");

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Execution error:", err);
    process.exit(1);
  });
}
