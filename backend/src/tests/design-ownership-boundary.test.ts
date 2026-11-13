/**
 * Cross-customer custom-design authorization regression suite.
 *
 * Covers SF-001: a customer must never be able to read, price against, attach,
 * or mutate another customer's CustomDesign through the cart or order flow.
 *
 * The tests exercise the real controllers, not just the helper, so a future
 * refactor that removes an ownership check fails here.
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Request, Response } from "express";
import { Cart } from "../models/Cart";
import { CustomDesign } from "../models/CustomDesign";
import { Product } from "../models/Product";
import { Address } from "../models/Address";
import { Order } from "../models/Order";
import { addItemToCart, updateCartItemQuantity } from "../controllers/cartController";
import { createOrder } from "../controllers/orderController";
import { extractDesignIds, loadOwnedDesignsOrThrow } from "../utils/designOwnership";
import { connectSafeTestDb, createTestDesign, createTestProduct } from "./testHelpers";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, name: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    const msg = details ? `${name} — ${details}` : name;
    console.log(`  ❌ FAIL: ${msg}`);
    failures.push(msg);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function invoke(
  handler: (req: any, res: any, next: any) => unknown,
  req: Record<string, unknown>
): Promise<{ res: MockResponse; err: any }> {
  const res = createMockRes();
  let captured: any;
  const next = (err?: unknown) => {
    captured = err;
  };
  await handler(req as unknown as Request, res as unknown as Response, next);
  return { res, err: captured };
}

const attackerId = new mongoose.Types.ObjectId().toString();
const victimId = new mongoose.Types.ObjectId().toString();

let productId: string;
let variantId: string;
let attackerDesignId: string;
let victimDesignId: string;
let addressId: string;

async function seedScenario(): Promise<void> {
  const { product, productId: pid, variantIds } = await createTestProduct({
    name: "Ownership Boundary Tee",
    variants: [{ size: "M", color: "BLACK", additionalPrice: 0, stock: 100, isAvailable: true }],
    printMethods: ["DTF"],
  });
  productId = pid;
  variantId = variantIds[0];

  const attackerDesign = await createTestDesign({
    userId: attackerId,
    productId: product._id,
    variantId: variantIds[0],
    name: "Attacker own design",
  });
  attackerDesignId = attackerDesign.designId;

  const victimDesign = await createTestDesign({
    userId: victimId,
    productId: product._id,
    variantId: variantIds[0],
    name: "Victim private design",
  });
  victimDesignId = victimDesign.designId;

  const address = await Address.create({
    userId: new mongoose.Types.ObjectId(attackerId),
    fullName: "Attacker Customer",
    phone: "9876543210",
    addressLine1: "1 Attacker Street",
    city: "New Delhi",
    state: "Delhi",
    postalCode: "110001",
    country: "India",
    addressType: "HOME",
    isDefault: true,
  });
  addressId = address._id.toString();
}

function customConfigurationsWith(designId: string) {
  return [
    {
      color: "BLACK",
      variantId: new mongoose.Types.ObjectId(variantId),
      designId: new mongoose.Types.ObjectId(designId),
      sizeDistribution: [{ size: "M", quantity: 1 }],
    },
  ];
}

async function seedCart(designId: string): Promise<any> {
  await Cart.deleteMany({ userId: attackerId });
  return Cart.create({
    userId: new mongoose.Types.ObjectId(attackerId),
    items: [
      {
        productId: new mongoose.Types.ObjectId(productId),
        variantId: new mongoose.Types.ObjectId(variantId),
        quantity: 1,
        isCustomized: true,
        customConfigurations: customConfigurationsWith(designId),
      },
    ],
  });
}

async function assertVictimDesignUntouched(label: string): Promise<void> {
  const victim = await CustomDesign.findById(victimDesignId);
  check(Boolean(victim), `${label}: victim design still exists`);
  check(victim?.status === "DRAFT", `${label}: victim design status remains DRAFT`, `status=${victim?.status}`);
  check(victim?.orderId === undefined, `${label}: victim design has no order link`, `orderId=${victim?.orderId}`);
}

async function runTests(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Cross-Customer Design Ownership Boundary Test Suite         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();
  const originalCustomDesignFlag = process.env.ENABLE_CUSTOM_DESIGN;
  process.env.ENABLE_CUSTOM_DESIGN = "true";

  try {
    await seedScenario();

    // ─────────────────────────────────────────────────────────────
    console.log("[GROUP 1: Ownership helper]");
    {
      const ids = extractDesignIds({
        customConfigurations: [{ designId: attackerDesignId }],
        customDesignId: victimDesignId,
      });
      check(ids.length === 2, "1.1 extractDesignIds includes V2 and legacy references", `ids=${ids.length}`);

      const owned = await loadOwnedDesignsOrThrow([attackerDesignId], attackerId);
      check(owned.has(attackerDesignId), "1.2 Attacker can load their own design");

      let foreignErr: any;
      try {
        await loadOwnedDesignsOrThrow([victimDesignId], attackerId);
      } catch (err) {
        foreignErr = err;
      }
      check(
        foreignErr?.statusCode === 403 && foreignErr?.code === "FORBIDDEN",
        "1.3 Foreign design ID is rejected with uniform 403 FORBIDDEN",
        `status=${foreignErr?.statusCode} code=${foreignErr?.code}`
      );

      let malformedErr: any;
      try {
        await loadOwnedDesignsOrThrow(["not-a-valid-object-id"], attackerId);
      } catch (err) {
        malformedErr = err;
      }
      check(
        malformedErr?.statusCode === 403 && malformedErr?.code === "FORBIDDEN",
        "1.4 Malformed design ID is rejected with the same 403 (no existence oracle)",
        `status=${malformedErr?.statusCode} code=${malformedErr?.code}`
      );
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 2: addItemToCart]");
    await Cart.deleteMany({ userId: attackerId });
    {
      const { err } = await invoke(
        addItemToCart,
        {
          user: { id: attackerId },
          body: {
            productId,
            variantId,
            quantity: 1,
            isCustomized: true,
            customConfigurations: customConfigurationsWith(victimDesignId),
          },
        }
      );
      check(
        err?.statusCode === 403 && err?.code === "FORBIDDEN",
        "2.1 Adding a cart item with a victim design is rejected with 403",
        `status=${err?.statusCode} code=${err?.code}`
      );
      const cart = await Cart.findOne({ userId: attackerId });
      check(cart === null, "2.2 No cart is created or mutated for the rejected request");
      await assertVictimDesignUntouched("2.3");
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 3: updateCartItemQuantity]");
    {
      const cart = await seedCart(attackerDesignId);
      const itemId = cart.items[0]._id.toString();

      const { err } = await invoke(
        updateCartItemQuantity,
        {
          user: { id: attackerId },
          params: { itemId },
          body: { customConfigurations: customConfigurationsWith(victimDesignId) },
        }
      );
      check(
        err?.statusCode === 403 && err?.code === "FORBIDDEN",
        "3.1 Swapping a cart item to a victim design is rejected with 403",
        `status=${err?.statusCode} code=${err?.code}`
      );

      const reloaded = await Cart.findOne({ userId: attackerId });
      check(
        reloaded?.items[0].customConfigurations?.[0].designId?.toString() === attackerDesignId,
        "3.2 Cart item still references the attacker's own design",
        `designId=${reloaded?.items[0].customConfigurations?.[0].designId}`
      );
      await assertVictimDesignUntouched("3.3");
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 4: createOrder]");
    {
      const cart = await seedCart(victimDesignId);
      const { err } = await invoke(createOrder, {
        user: { id: attackerId },
        body: { addressId },
      });
      check(
        err?.statusCode === 403 && err?.code === "FORBIDDEN",
        "4.1 Checkout with a victim design is rejected with 403 before any write",
        `status=${err?.statusCode} code=${err?.code}`
      );

      const orderCount = await Order.countDocuments({ userId: attackerId });
      check(orderCount === 0, "4.2 No order is created for the rejected checkout", `orders=${orderCount}`);
      check(cart.items.length === 1, "4.3 The attacker's cart is not consumed");
      await assertVictimDesignUntouched("4.4");
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 5: Legacy customDesignId boundary]");
    {
      await Cart.deleteMany({ userId: attackerId });
      await Cart.create({
        userId: new mongoose.Types.ObjectId(attackerId),
        items: [
          {
            productId: new mongoose.Types.ObjectId(productId),
            variantId: new mongoose.Types.ObjectId(variantId),
            quantity: 1,
            isCustomized: true,
            customDesignId: new mongoose.Types.ObjectId(victimDesignId),
          },
        ],
      });

      const { err } = await invoke(createOrder, {
        user: { id: attackerId },
        body: { addressId },
      });
      check(
        err?.statusCode === 403 && err?.code === "FORBIDDEN",
        "5.1 Legacy customDesignId references are subject to the same ownership check",
        `status=${err?.statusCode} code=${err?.code}`
      );
      await assertVictimDesignUntouched("5.2");
    }
  } finally {
    await Cart.deleteMany({ userId: attackerId });
    await CustomDesign.deleteMany({ userId: attackerId });
    await CustomDesign.deleteMany({ userId: victimId });
    await Address.deleteMany({ userId: attackerId });
    await Order.deleteMany({ userId: attackerId });
    await Product.deleteMany({ _id: productId });
    if (originalCustomDesignFlag === undefined) delete process.env.ENABLE_CUSTOM_DESIGN;
    else process.env.ENABLE_CUSTOM_DESIGN = originalCustomDesignFlag;
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("══════════════════════════════════════════════════════════════\n");
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});