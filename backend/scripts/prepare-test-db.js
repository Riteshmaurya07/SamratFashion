/**
 * Pre-builds every Mongoose index in the isolated test database.
 *
 * Several suites (phase-a-return-refund-integrity, phase-a-blocker-remediation)
 * start writing immediately after connecting. On a brand-new database, MongoDB
 * may still be building indexes in the background, which makes those writes fail
 * with transient `LockTimeout` / "catalog changes" errors. Building indexes up
 * front removes that race and keeps CI deterministic.
 *
 * Usage (from `backend/`, after `npm run build`):
 *   TEST_MONGODB_URI=... node scripts/prepare-test-db.js
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const modelsDir = path.join(process.cwd(), "dist", "models");

(async () => {
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    throw new Error("TEST_MONGODB_URI is required");
  }

  await mongoose.connect(uri);

  const modelNames = new Set();
  const indexWarnings = [];

  for (const file of fs.readdirSync(modelsDir).filter((name) => name.endsWith(".js"))) {
    const mod = require(path.join(modelsDir, file));
    for (const value of Object.values(mod)) {
      // Mongoose models are functions (or classes) with `init` and `modelName`.
      const model = value;
      if (!model || typeof model.init !== "function" || typeof model.modelName !== "string") {
        continue;
      }
      modelNames.add(model.modelName);
      try {
        await model.init();
      } catch (error) {
        // A broken index definition must not block the rest of the warm-up;
        // the suite that owns that model will surface the real error.
        indexWarnings.push(`${model.modelName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`[test-prepare] Indexes ready for ${modelNames.size} models in ${mongoose.connection.name}`);
  if (indexWarnings.length > 0) {
    console.log(`[test-prepare] WARN: ${indexWarnings.length} model(s) reported index issues:`);
    for (const warning of indexWarnings) {
      console.log(`  - ${warning}`);
    }
  }

  await mongoose.disconnect();
})().catch((error) => {
  console.error("[test-prepare] Failed:", error);
  process.exit(1);
});
