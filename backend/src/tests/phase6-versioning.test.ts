/**
 * Phase 6 — Version Immutability Test Suite
 *
 * Tests:
 * - V1 purchased → approved → immutable
 * - Revision creates V2 (DRAFT)
 * - V1 data unchanged after V2 created
 * - Order still references V1
 * - V1 remains CUSTOMER_APPROVED in versions array
 */

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { Product } from "../models/Product";
import { IDesignLayout } from "../models/CustomTemplate";
import { createTestProduct } from "./testHelpers";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(name: string) { console.log(`  ✅ PASS: ${name}`); passed++; }
function fail(name: string, reason: string) {
  console.error(`  ❌ FAIL: ${name} — ${reason}`);
  failed++; failures.push(`${name}: ${reason}`);
}
function check(condition: boolean, name: string, failReason: string) {
  if (condition) pass(name); else fail(name, failReason);
}

const V1_LAYOUT: IDesignLayout = {
  front: { elements: [{ id: "v1-front", type: "TEXT", x: 100, y: 100, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 0, properties: { text: "Version 1 Logo" } }] },
  back: { elements: [] },
  leftSleeve: { elements: [] },
  rightSleeve: { elements: [] },
};

const V2_LAYOUT: IDesignLayout = {
  front: { elements: [{ id: "v2-front", type: "TEXT", x: 100, y: 100, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 0, properties: { text: "Version 2 Revision" } }] },
  back: { elements: [{ id: "v2-back", type: "IMAGE", x: 50, y: 200, width: 300, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 0, properties: { imageUrl: "https://example.com/logo.png" } }] },
  leftSleeve: { elements: [] },
  rightSleeve: { elements: [] },
};

let testProductId: string;
let testDesignId: string;
const testUserId = new mongoose.Types.ObjectId().toString();
const mockOrderId = new mongoose.Types.ObjectId().toString();

async function seed() {
  const { product, productId: pid } = await createTestProduct({ name: "Version Test Tee" });
  testProductId = pid;

  const design = await CustomDesign.create({
    userId: new mongoose.Types.ObjectId(testUserId),
    name: "Immutability Test Design",
    productId: product._id,
    selectedVariantId: product.variants[0]._id,
    selectedColor: "BLACK",
    status: "DRAFT",
    requestType: "DESIGN",
    printLocations: ["FRONT"],
    submissionKey: `ver-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    currentVersion: 1,
    design: V1_LAYOUT,
    versions: [{
      version: 1,
      design: V1_LAYOUT,
      createdBy: new mongoose.Types.ObjectId(testUserId),
      createdAt: new Date(),
      status: "DRAFT",
      previewUrls: [],
      artworkUrls: [],
    }],
  });
  testDesignId = design._id.toString();
}

async function cleanup() {
  if (testDesignId) await CustomDesign.deleteOne({ _id: testDesignId });
  if (testProductId) await Product.deleteOne({ _id: testProductId });
}

async function runVersionTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 6 — Version Immutability Test Suite       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");
  await seed();

  // VER-1: Set V1 as SUBMITTED → CUSTOMER_REVIEW → simulate approval
  console.log("\n[VER-1] Purchase and approve V1");
  {
    await CustomDesign.findByIdAndUpdate(testDesignId, {
      status: "CUSTOMER_REVIEW",
      orderId: new mongoose.Types.ObjectId(mockOrderId),
    });

    // Simulate approveDesign controller
    const design = await CustomDesign.findById(testDesignId);
    if (!design) { fail("VER-1.1", "Design not found"); return; }

    design.status = "CUSTOMER_APPROVED";
    design.approvedVersion = design.currentVersion; // = 1
    design.approvedAt = new Date();
    design.approvedBy = new mongoose.Types.ObjectId(testUserId);

    const versionIndex = design.versions.findIndex((v: any) => v.version === design.currentVersion);
    if (versionIndex > -1) {
      (design.versions[versionIndex] as any).status = "CUSTOMER_APPROVED";
    }
    await design.save();

    const saved = await CustomDesign.findById(testDesignId);
    check(saved?.approvedVersion === 1, "VER-1.1 approvedVersion set to 1 after approval", `approvedVersion=${saved?.approvedVersion}`);
    check(saved?.status === "CUSTOMER_APPROVED", "VER-1.2 Top-level status = CUSTOMER_APPROVED", `status=${saved?.status}`);
    check(saved?.versions[0].status === "CUSTOMER_APPROVED", "VER-1.3 V1 in versions[] marked CUSTOMER_APPROVED", `v1 status=${saved?.versions[0].status}`);

    // Verify V1 layout is intact
    const v1Layout = saved?.versions[0].design as any;
    const v1TextEl = v1Layout?.front?.elements?.[0]?.properties?.text;
    check(v1TextEl === "Version 1 Logo", "VER-1.4 V1 design layout preserved correctly", `text=${v1TextEl}`);
  }

  // VER-2: Attempt to modify approved design — must be blocked
  console.log("\n[VER-2] Modification attempt on approved design");
  {
    const design = await CustomDesign.findById(testDesignId);
    if (!design) { fail("VER-2.1", "Design not found"); return; }

    const isBlocked = !!(design.approvedVersion && design.currentVersion === design.approvedVersion);
    check(isBlocked, "VER-2.1 Approved version correctly identified as immutable", `approvedVersion=${design.approvedVersion}, currentVersion=${design.currentVersion}`);
  }

  // VER-3: Revision creates V2, preserves V1 immutability
  console.log("\n[VER-3] Request revision creates V2 draft");
  {
    const design = await CustomDesign.findById(testDesignId);
    if (!design) { fail("VER-3.1", "Design not found"); return; }

    const v1DataBefore = JSON.stringify(design.versions[0].design);

    // Simulate requestRevision controller (atomic update)
    const updatedDesign = await CustomDesign.findOneAndUpdate(
      { _id: testDesignId, currentVersion: design.currentVersion },
      {
        $set: { status: "DRAFT" },
        $inc: { currentVersion: 1 },
        $push: {
          versions: {
            version: design.currentVersion + 1,
            design: V2_LAYOUT,
            createdBy: new mongoose.Types.ObjectId(testUserId),
            createdAt: new Date(),
            status: "DRAFT",
            revisionComment: "Phase 6 revision test",
            previewUrls: [],
            artworkUrls: [],
          }
        }
      },
      { returnDocument: 'after' }
    );

    if (!updatedDesign) { fail("VER-3.1", "Optimistic lock prevented update — concurrent modification?"); return; }

    check(updatedDesign.currentVersion === 2, "VER-3.1 currentVersion incremented to 2", `currentVersion=${updatedDesign.currentVersion}`);
    check(updatedDesign.status === "DRAFT", "VER-3.2 Top-level status reset to DRAFT", `status=${updatedDesign.status}`);
    check(updatedDesign.versions.length === 2, "VER-3.3 Two versions in versions[]", `count=${updatedDesign.versions.length}`);

    // Verify V1 unchanged
    const v1After = updatedDesign.versions.find((v: any) => v.version === 1);
    const v1DataAfter = JSON.stringify(v1After?.design);
    check(v1DataAfter === v1DataBefore, "VER-3.4 V1 design data UNCHANGED after revision", "V1 design was mutated!");
    check(v1After?.status === "CUSTOMER_APPROVED", "VER-3.5 V1 version status remains CUSTOMER_APPROVED", `v1 status=${v1After?.status}`);
    check(updatedDesign.approvedVersion === 1, "VER-3.6 approvedVersion still references V1 (not V2)", `approvedVersion=${updatedDesign.approvedVersion}`);

    // V2 should be DRAFT
    const v2 = updatedDesign.versions.find((v: any) => v.version === 2);
    check(v2?.status === "DRAFT", "VER-3.7 V2 is DRAFT", `v2 status=${v2?.status}`);
    const v2Text = (v2?.design as any)?.front?.elements?.[0]?.properties?.text;
    check(v2Text === "Version 2 Revision", "VER-3.8 V2 contains new design content", `v2 text=${v2Text}`);
  }

  // VER-4: Order references V1 even after V2 created
  console.log("\n[VER-4] Order continues referencing approved V1");
  {
    const design = await CustomDesign.findById(testDesignId);
    check(
      design?.orderId?.toString() === mockOrderId,
      "VER-4.1 orderId persists and still points to original order",
      `orderId=${design?.orderId}`
    );
    check(
      design?.approvedVersion === 1,
      "VER-4.2 approvedVersion=1 — V2 draft does NOT replace production reference",
      `approvedVersion=${design?.approvedVersion}`
    );
  }

  await cleanup();

  console.log("\n══════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach((f) => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runVersionTests().catch((e) => {
  console.error("Version test runner crashed:", e);
  process.exit(1);
});
