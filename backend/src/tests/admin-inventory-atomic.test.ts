import mongoose from "mongoose";
import { Request, Response } from "express";
import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { adjustInventory } from "../controllers/adminCatalogController";
import { AuditLog } from "../models/AuditLog";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { Product } from "../models/Product";

async function runTests(): Promise<void> {
  await connectSafeTestDb();
  const { product, variantIds } = await createTestProduct({
    name: `Inventory audit rollback ${Date.now()}`,
    variants: [{ size: "M", color: "BLACK", stock: 10 }],
  });
  const variantId = variantIds[0];
  const adminId = new mongoose.Types.ObjectId().toString();
  let capturedError: unknown;

  try {
    const request = {
      user: { id: adminId },
      params: { productId: product._id.toString(), variantId },
      body: { quantity: 5, type: "RESTOCK", reason: "Regression test" },
    } as unknown as Request;
    const response = {
      status() { return this; },
      json() { return this; },
    };

    await adjustInventory(request, response as unknown as Response, error => { capturedError = error; });
    const savedProduct = await Product.findById(product._id);
    const ledgerCount = await InventoryTransaction.countDocuments({
      productId: product._id,
      variantId: new mongoose.Types.ObjectId(variantId),
      reason: "Regression test",
    });
    const auditCount = await AuditLog.countDocuments({
      entityId: product._id,
      action: "ADMIN_INVENTORY_ADJUSTED",
      "metadata.reason": "Regression test",
    });

    if (!capturedError || savedProduct?.variants[0]?.stock !== 10 || ledgerCount !== 0 || auditCount !== 0) {
      throw new Error("Inventory stock and audit records were not rolled back together after audit validation failed");
    }

    console.log("PASS: failed audit write leaves stock and inventory ledger unchanged");
  } finally {
    await InventoryTransaction.deleteMany({ productId: product._id });
    await AuditLog.deleteMany({ entityId: product._id });
    await Product.deleteOne({ _id: product._id });
    await mongoose.disconnect();
  }
}

runTests().catch(error => {
  console.error("Inventory atomicity test failed:", error);
  process.exit(1);
});
