import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { verifyDatabaseTransactionSupport } from "../config/db";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useTestUri = args.includes("--test");
  const uriArg = args.find((a) => a.startsWith("--uri="))?.slice(6);

  const uri =
    uriArg ||
    (useTestUri
      ? process.env.TEST_MONGODB_URI
      : process.env.MONGODB_URI || process.env.Mongodb_URI);

  if (!uri) {
    console.error(`❌ Error: ${useTestUri ? "TEST_MONGODB_URI" : "MONGODB_URI"} is not defined in environment variables.`);
    process.exit(1);
  }

  // Mask credentials for display
  const maskedUri = uri.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");

  console.log("\n=======================================================");
  console.log("🔍 Samrat Fashion Database Transaction Verification");
  console.log("=======================================================");
  console.log(`Target: ${maskedUri}`);
  console.log(`Connecting to MongoDB...`);

  try {
    await mongoose.connect(uri);
    console.log(`Connected successfully to host: ${mongoose.connection.host}\n`);

    const result = await verifyDatabaseTransactionSupport(mongoose.connection);

    console.log("-------------------------------------------------------");
    console.log(`Topology:           ${result.topology.toUpperCase()}`);
    console.log(`Replica Set Name:   ${result.setName || "None (Standalone)"}`);
    console.log(`Transaction Status: ${result.supported ? "✅ SUPPORTED" : "❌ NOT SUPPORTED"}`);
    if (result.error) {
      console.log(`Details:            ${result.error}`);
    }
    console.log("-------------------------------------------------------");

    if (result.supported) {
      console.log("\n🎉 Verification Succeeded: The database is ready for multi-document transactions.");
      console.log("   (Payment capture, cancellations, and inventory restorations will operate safely.)\n");
      process.exit(0);
    } else {
      console.error("\n⚠️  Verification Failed: Multi-document transactions are NOT supported by this instance.");
      console.error("   Production requires MongoDB Atlas or an initialized Replica Set (e.g. rs.initiate()).\n");
      process.exit(1);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Fatal Connection Error: ${errorMsg}\n`);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error during transaction verification:", err);
  process.exit(1);
});
