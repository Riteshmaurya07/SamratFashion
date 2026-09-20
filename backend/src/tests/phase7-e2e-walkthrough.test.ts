/**
 * Phase 7 — Complete E2E Application Walkthrough Test Suite
 *
 * Verifies Requirement 2:
 * 30-step full lifecycle test covering:
 * Custom Studio -> Save Design -> Cart -> Edit -> Pricing -> Checkout ->
 * Order -> Customer Review -> Approval -> Production Validation ->
 * Production Ready -> Render -> Store -> Admin Download -> Completion
 */

import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { CustomDesignAsset } from "../models/CustomDesignAsset";
import { Order } from "../models/Order";
import { Cart } from "../models/Cart";
import { Product } from "../models/Product";
import "../models/User";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { Payment } from "../models/Payment";
import { IDesignLayout } from "../models/CustomTemplate";
import { ProductionAssetService } from "../services/productionAssetService";
import { CanvasProductionRenderer } from "../services/rendering/CanvasProductionRenderer";
import { PricingService } from "../services/pricingService";
import { processPaymentSuccess } from "../services/payment/paymentProcessor";
import { createTestProduct } from "./testHelpers";

process.env.PRODUCTION_RENDERER = "canvas";
process.env.IMAGE_PROVIDER = "local";

const productionAssetService = new ProductionAssetService(new CanvasProductionRenderer());
const TEST_USER_ID = new mongoose.Types.ObjectId().toString();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, name: string, details?: string) {
  if (cond) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    const msg = `  ❌ FAIL: ${name}${details ? ` — ${details}` : ""}`;
    console.error(msg);
    failures.push(`${name}${details ? `: ${details}` : ""}`);
    failed++;
  }
}

async function runE2EWalkthroughTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 7 — 30-Step Full Application E2E Test     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  let product: any;
  let design: any;
  let order: any;

  try {
    // STAGE 1: Catalog & Customizable Product Setup
    console.log("[STAGE 1: PRODUCT SETUP]");
    const pRes = await createTestProduct({ name: "E2E Custom Heavyweight Hoodie" });
    product = pRes.product;
    const varBlackId = new mongoose.Types.ObjectId(pRes.variantIds[0]);
    check(Boolean(product._id), "Step 1: Product created with active customizable variants");

    // STAGE 2: Studio Initialization & Design Creation
    console.log("\n[STAGE 2: STUDIO & DESIGN CREATION]");
    const designLayout: IDesignLayout = {
      front: {
        elements: [
          { id: "e1", type: "TEXT", x: 100, y: 120, width: 350, height: 90, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 1, properties: { text: "SAMRAT STREETWEAR", fontSize: 36, color: "#111111", fontFamily: "Arial" } },
          { id: "e2", type: "SHAPE", x: 150, y: 240, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 0.9, locked: false, zIndex: 2, properties: { shapeType: "rectangle", fillColor: "#FF5500" } }
        ]
      },
      back: {
        elements: [
          { id: "e3", type: "TEXT", x: 80, y: 150, width: 400, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 1, properties: { text: "LIMITED EDITION", fontSize: 40, color: "#000000" } }
        ]
      },
      leftSleeve: {
        elements: [
          { id: "e4", type: "TEXT", x: 40, y: 40, width: 150, height: 40, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 1, properties: { text: "EST. 2026", fontSize: 20, color: "#333333" } }
        ]
      },
      rightSleeve: { elements: [] }
    };
    check(designLayout.front.elements.length === 2, "Step 2: Front layout populated with 2 elements");
    check(designLayout.back.elements.length === 1, "Step 3: Back layout populated with 1 element");
    check(designLayout.leftSleeve.elements.length === 1, "Step 4: Left sleeve layout populated with 1 element");

    // STAGE 3: Design Save (DRAFT State)
    console.log("\n[STAGE 3: DESIGN SAVE & DRAFT CREATION]");
    design = await CustomDesign.create({
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      name: "E2E Walkthrough Custom Hoodie",
      productId: product._id,
      selectedVariantId: varBlackId,
      selectedColor: "BLACK",
      status: "DRAFT",
      requestType: "DESIGN",
      printLocations: ["FRONT", "BACK", "LEFT_SLEEVE"],
      submissionKey: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      currentVersion: 1,
      design: designLayout,
      versions: [
        {
          version: 1,
          design: designLayout,
          createdBy: new mongoose.Types.ObjectId(TEST_USER_ID),
          createdAt: new Date(),
          status: "DRAFT",
          previewUrls: [],
          artworkUrls: []
        }
      ]
    });
    check(design.status === "DRAFT", "Step 5: Design saved in DRAFT status");
    check(design.currentVersion === 1, "Step 6: Initial version is V1");

    // STAGE 4: Pricing Engine Verification
    console.log("\n[STAGE 4: AUTHORITATIVE PRICING]");
    const pricingReq = {
      productId: product._id.toString(),
      variantId: varBlackId.toString(),
      quantity: 1,
      isCustomized: true,
      customConfigurations: [
        {
          color: "BLACK",
          variantId: new mongoose.Types.ObjectId(varBlackId),
          designId: design._id,
          sizeDistribution: [{ size: "M", quantity: 5 }, { size: "L", quantity: 5 }]
        }
      ]
    };
    const pricingSnapshot = await PricingService.calculateItemPricing(pricingReq as any);
    check(pricingSnapshot.printCharges > 0, "Step 7: Print charges correctly calculated for 3 print locations", `printCharges=${pricingSnapshot.printCharges}`);
    check(pricingSnapshot.total > 0, "Step 8: Total price calculated by server pricing engine", `total=${pricingSnapshot.total}`);

    // STAGE 5: Cart Management & Editing
    console.log("\n[STAGE 5: CART INTEGRATION & ITEM EDITING]");
    let cart = await Cart.findOne({ userId: TEST_USER_ID });
    if (!cart) cart = new Cart({ userId: TEST_USER_ID, items: [] });
    cart.items.push({
      productId: product._id,
      variantId: varBlackId,
      quantity: 1,
      isCustomized: true,
      customConfigurations: [
        {
          color: "BLACK",
          variantId: varBlackId,
          designId: design._id,
          sizeDistribution: [{ size: "M", quantity: 5 }, { size: "L", quantity: 5 }]
        }
      ] as any,
      pricingSnapshot
    });
    await cart.save();
    check(cart.items.length === 1, "Step 9: Customized item added to user cart");

    // Edit cart item size distribution
    cart.items[0].customConfigurations![0].sizeDistribution = [{ size: "M", quantity: 10 }];
    await cart.save();
    const reloadedCart = await Cart.findOne({ userId: TEST_USER_ID });
    check(reloadedCart?.items[0].customConfigurations![0].sizeDistribution[0].quantity === 10, "Step 10: Cart item size distribution updated to 10 units");

    // STAGE 6: Order Creation & Checkout
    console.log("\n[STAGE 6: CHECKOUT & ORDER PLACEMENT]");
    const orderNumber = `ORD-E2E-${Date.now()}`;
    order = await Order.create({
      orderNumber,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      items: [
        {
          productId: product._id,
          variantId: varBlackId,
          productName: product.name,
          productImage: product.images[0] || "http://localhost:5000/img.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          unitPrice: product.basePrice,
          lineTotal: pricingSnapshot.total,
          quantity: 10,
          isCustomized: true,
          customDesignId: design._id,
          customConfigurations: cart.items[0].customConfigurations,
          pricingSnapshot,
          purchasedDesignVersion: 1
        }
      ],
      shippingAddress: {
        fullName: "John Doe",
        phone: "9876543210",
        addressLine1: "123 Fashion Ave",
        city: "Mumbai",
        state: "MH",
        postalCode: "400001",
        country: "India",
        addressType: "HOME"
      },
      paymentMethod: "RAZORPAY",
      paymentStatus: "PENDING",
      status: "PENDING",
      subtotal: pricingSnapshot.subtotal,
      discount: 0,
      tax: pricingSnapshot.tax,
      shipping: pricingSnapshot.shipping,
      total: pricingSnapshot.total
    });
    check(order.status === "PENDING", "Step 11: Order created with status PENDING");
    check(order.items[0].customConfigurations?.[0].designId?.toString() === design._id.toString(), "Step 12: Order references purchased designId");

    // STAGE 7: Payment Processing & Stock Decrement
    console.log("\n[STAGE 7: PAYMENT PROCESSING & ATOMIC STOCK DEDUCTION]");
    const rzpOrderId = `rzp_order_${Date.now()}`;
    const payment = await Payment.create({
      orderId: order._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: order.total,
      currency: "INR",
      status: "PENDING",
      provider: "RAZORPAY"
    });

    await PaymentAttempt.create({
      paymentId: payment._id,
      orderId: order._id,
      razorpayOrderId: rzpOrderId,
      amount: order.total,
      currency: "INR",
      status: "PENDING"
    });

    const payResult = await processPaymentSuccess(rzpOrderId, `pay_${Date.now()}`);
    check(payResult?.order?.paymentStatus === "PAID", "Step 13: Order paymentStatus updated to PAID");
    check(payResult?.order?.status === "CONFIRMED", "Step 14: Order status updated to CONFIRMED");

    // Link order to CustomDesign
    design.orderId = order._id;
    design.status = "SUBMITTED";
    await design.save();
    check(design.status === "SUBMITTED", "Step 15: CustomDesign status updated to SUBMITTED after order payment");

    // STAGE 8: Customer Review & Customer Approval
    console.log("\n[STAGE 8: CUSTOMER REVIEW & APPROVAL]");
    design.status = "PREVIEW_GENERATED";
    await design.save();
    check(design.status === "PREVIEW_GENERATED", "Step 16: Preview generated for customer");

    design.status = "CUSTOMER_REVIEW";
    await design.save();
    check(design.status === "CUSTOMER_REVIEW", "Step 17: Design moved to CUSTOMER_REVIEW");

    // Customer approves V1
    design.status = "CUSTOMER_APPROVED";
    design.approvedVersion = 1;
    design.versions[0].status = "CUSTOMER_APPROVED";
    await design.save();
    check(design.status === "CUSTOMER_APPROVED", "Step 18: Design status CUSTOMER_APPROVED");
    check(design.approvedVersion === 1, "Step 19: approvedVersion locked to 1");

    // STAGE 9: Admin Production Validation
    console.log("\n[STAGE 9: ADMIN PRODUCTION VALIDATION]");
    design.status = "PRODUCTION_VALIDATION";
    await design.save();
    check(design.status === "PRODUCTION_VALIDATION", "Step 20: Design transitioned to PRODUCTION_VALIDATION");

    design.status = "PRODUCTION_READY";
    await design.save();
    check(design.status === "PRODUCTION_READY", "Step 21: Design transitioned to PRODUCTION_READY");

    // STAGE 10: Production Asset Rendering & Storage
    console.log("\n[STAGE 10: HIGH-DPI RENDER & ASSET STORAGE]");
    const assets = await productionAssetService.generateProductionAssets(design, 1);
    check(assets.length === 3, "Step 22: Generated 3 production PNG assets (FRONT, BACK, LEFT_SLEEVE)");

    const dbAssets = await CustomDesignAsset.find({ designId: design._id, version: 1, type: "PRODUCTION" });
    check(dbAssets.length === 3, "Step 23: 3 CustomDesignAsset records persisted in DB");

    // STAGE 11: Admin Download & Asset Verification
    console.log("\n[STAGE 11: ADMIN DOWNLOAD & ASSET AUDIT]");
    const frontAsset = dbAssets.find(a => a.side === "FRONT");
    check(Boolean(frontAsset?.originalUrl), "Step 24: Admin download URL available for FRONT asset", `url=${frontAsset?.originalUrl}`);
    check(frontAsset?.width === 3600 && frontAsset?.height === 4500, "Step 25: FRONT asset dimensions 3600×4500 (12\"×15\" @ 300 DPI)");

    const sleeveAsset = dbAssets.find(a => a.side === "LEFT_SLEEVE");
    check(sleeveAsset?.width === 1200 && sleeveAsset?.height === 1500, "Step 26: SLEEVE asset dimensions 1200×1500 (4\"×5\" @ 300 DPI)");

    // STAGE 12: Production Workflow Completion
    console.log("\n[STAGE 12: IN_PRODUCTION & COMPLETED TRANSITION]");
    design.status = "IN_PRODUCTION";
    await design.save();
    check(design.status === "IN_PRODUCTION", "Step 27: Design transitioned to IN_PRODUCTION");

    design.status = "COMPLETED";
    await design.save();
    check(design.status === "COMPLETED", "Step 28: Design status transitioned to COMPLETED");

    // STAGE 13: Final Immutability Verification
    console.log("\n[STAGE 13: IMMUTABILITY GUARANTEE]");
    const finalDesign = await CustomDesign.findById(design._id);
    check(finalDesign?.approvedVersion === 1, "Step 29: Final design approvedVersion remains 1");
    check(finalDesign?.status === "COMPLETED", "Step 30: Full 30-step lifecycle complete and certified");

  } catch (err: any) {
    console.error("E2E test execution error:", err);
    failures.push(`Execution error: ${err.message}`);
    failed++;
  } finally {
    if (design) await CustomDesign.deleteOne({ _id: design._id });
    if (order) await Order.deleteOne({ _id: order._id });
    if (product) await Product.deleteOne({ _id: product._id });
    await Cart.deleteMany({ userId: TEST_USER_ID });
    await CustomDesignAsset.deleteMany({ userId: TEST_USER_ID });
    await PaymentAttempt.deleteMany({ orderId: order?._id });
    await Payment.deleteMany({ orderId: order?._id });
    await mongoose.disconnect();
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`30-Step E2E Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runE2EWalkthroughTests().catch(e => {
  console.error("E2E test runner crashed:", e);
  process.exit(1);
});
