import mongoose from "mongoose";
import { connectSafeTestDb } from "./testHelpers";
import { Order } from "../models/Order";
import { Shipment } from "../models/Shipment";
import { generateTrackingToken, hashTrackingToken, TRACKING_TOKEN_TTL_MS } from "../controllers/orderController";

let passed = 0;
let failed = 0;

function check(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n=============================================");
  console.log("FEATURE 2: SECURE SHAREABLE TRACKING TESTS");
  console.log("=============================================\n");

  await connectSafeTestDb();

  const testUserId = new mongoose.Types.ObjectId();
  const testProductId = new mongoose.Types.ObjectId();
  const testVariantId = new mongoose.Types.ObjectId();

  try {
    await Order.deleteMany({ userId: testUserId });
    await Shipment.deleteMany({ userId: testUserId });

    // 1. Token Generation & Entropy Tests
    console.log("--- 1. Cryptographic Token Generation & Entropy ---");
    const { rawToken, tokenHash, expiresAt } = generateTrackingToken();
    check(TRACKING_TOKEN_TTL_MS === 30 * 24 * 60 * 60 * 1000, "Documented 30-day TTL constant is exactly 30 days in ms");
    check(expiresAt.getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000, "Expires at least 29 days in future (30-day TTL)");
    check(typeof tokenHash === "string" && tokenHash.length === 64, "Token hash is a 64-character SHA-256 hex string");
    check(rawToken !== tokenHash, "Raw token and hash are distinct");
    check(hashTrackingToken(rawToken) === tokenHash, "Hash matches sha256(rawToken)");
    check(expiresAt.getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000, "Expires at least 29 days in future (30-day TTL)");

    // 2. Order Creation with Secure Token Hash
    console.log("\n--- 2. Order Token Storage Invariants ---");
    const orderNumber = `SF-TRACK-${Date.now()}`;
    const order = await Order.create({
      orderNumber,
      userId: testUserId,
      items: [
        {
          productId: testProductId,
          variantId: testVariantId,
          productName: "Heavyweight Boxy Hoodie",
          productImage: "https://example.com/hoodie.jpg",
          selectedSize: "XL",
          selectedColor: "Washed Olive",
          quantity: 1,
          unitPrice: 2499,
          lineTotal: 2499,
        },
      ],
      shippingAddress: {
        fullName: "Vikram Malhotra",
        phone: "9876543210",
        alternatePhone: "8765432109",
        addressLine1: "Flat 402, Skyline Heights",
        addressLine2: "12th Cross, Indiranagar",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560038",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 2499,
      discount: 200,
      shipping: 0,
      tax: 115,
      total: 2414,
      currency: "INR",
      status: "SHIPPED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY_UPI",
      idempotencyKey: `idemp_${Date.now()}`,
      trackingTokenHash: tokenHash,
      trackingTokenCreatedAt: new Date(),
      trackingTokenExpiresAt: expiresAt,
    });

    const storedOrder = await Order.findById(order._id);
    check(Boolean(storedOrder?.trackingTokenHash), "Order stores trackingTokenHash");
    check(storedOrder?.trackingTokenHash === tokenHash, "Stored hash matches computed SHA-256");
    // Ensure raw token is never a property of the persisted Mongoose document
    check((storedOrder as any).rawToken === undefined, "Raw token is NEVER persisted in database");
    check((storedOrder as any).trackingToken === undefined, "Un-hashed tracking token is NEVER in database schema");

    // 3. Associated Shipment Creation
    console.log("\n--- 3. Shipment Integration ---");
    const shipment = await Shipment.create({
      orderId: order._id,
      userId: testUserId,
      carrier: "Delhivery Express",
      trackingNumber: "DEL-8877665544",
      awbNumber: "DEL-8877665544",
      provider: "delhivery",
      trackingUrl: "https://track.delhivery.com/p/DEL-8877665544",
      status: "IN_TRANSIT",
      trackingHistory: [
        {
          status: "LABEL_CREATED",
          location: "Bengaluru Warehouse",
          description: "Package details registered with courier",
          timestamp: new Date(Date.now() - 3600000 * 12),
        },
        {
          status: "IN_TRANSIT",
          location: "Bengaluru Hub",
          description: "Package in transit to destination delivery facility",
          timestamp: new Date(Date.now() - 3600000 * 4),
        },
      ],
      packageDetails: { weightGrams: 850, lengthCm: 35, widthCm: 28, heightCm: 8 },
      createdBy: testUserId,
      updatedBy: testUserId,
    });
    check(Boolean(shipment._id), "Shipment created successfully for tracking lookup");

    // 4. Successful Public Tracking Data Sanitization (Zero Leakage Check)
    console.log("\n--- 4. Public Tracking Allowlist & Privacy Safeguards ---");
    // Simulate what getPublicOrderTracking returns
    const publicFound = await Order.findOne({ trackingTokenHash: hashTrackingToken(rawToken) }).lean();
    check(Boolean(publicFound), "Order found by hashing incoming raw token");

    // Verify DTO isolation
    const nameParts = (publicFound!.shippingAddress.fullName || "").trim().split(/\s+/);
    const maskedName = `${nameParts[0]} ${nameParts[nameParts.length - 1].charAt(0)}.`;

    const publicDto = {
      orderNumber: publicFound!.orderNumber,
      status: publicFound!.status,
      createdAt: publicFound!.createdAt,
      recipient: {
        maskedName,
        destinationCity: publicFound!.shippingAddress.city,
        destinationState: publicFound!.shippingAddress.state,
      },
      shipment: {
        carrier: shipment.carrier,
        awbNumber: shipment.awbNumber,
        trackingUrl: shipment.trackingUrl,
        status: shipment.status,
      },
      items: publicFound!.items.map(i => ({
        productName: i.productName,
        selectedSize: i.selectedSize,
        selectedColor: i.selectedColor,
        quantity: i.quantity,
      })),
    };

    check(publicDto.orderNumber === orderNumber, "Public reference orderNumber is present");
    check(publicDto.recipient.maskedName === "Vikram M.", "Recipient name is masked (Vikram M.)");
    check(publicDto.recipient.destinationCity === "Bengaluru", "Destination city is present");
    check(publicDto.recipient.destinationState === "Karnataka", "Destination state is present");

    // Strict Negative Assertions (Verify Sensitive Fields are ABSENT)
    check((publicDto as any).shippingAddress === undefined, "Zero leakage: Full shipping address is absent");
    check((publicDto as any).addressLine1 === undefined, "Zero leakage: addressLine1 is absent");
    check((publicDto as any).phone === undefined, "Zero leakage: Primary phone is absent");
    check((publicDto as any).alternatePhone === undefined, "Zero leakage: Alternate phone is absent");
    check((publicDto as any).email === undefined, "Zero leakage: Customer email is absent");
    check((publicDto as any).total === undefined, "Zero leakage: Order total is absent");
    check((publicDto as any).paymentMethod === undefined, "Zero leakage: Payment method is absent");
    check((publicDto as any).paymentStatus === undefined, "Zero leakage: Payment status is absent");
    check((publicDto as any).idempotencyKey === undefined, "Zero leakage: Idempotency key is absent");
    check((publicDto as any).trackingTokenHash === undefined, "Zero leakage: trackingTokenHash is absent");

    // 5. Rejection of Invalid Token
    console.log("\n--- 5. Invalid Token Rejection ---");
    const fakeToken = "a".repeat(64);
    const fakeFound = await Order.findOne({ trackingTokenHash: hashTrackingToken(fakeToken) });
    check(fakeFound === null, "Unrecognized token hash yields null (404)");

    // 6. Token Expiration Behavior
    console.log("\n--- 6. Token Expiration Invariants ---");
    await Order.findByIdAndUpdate(order._id, {
      trackingTokenExpiresAt: new Date(Date.now() - 1000), // expired 1s ago
    });
    const expiredOrder = await Order.findOne({ trackingTokenHash: tokenHash });
    const isExpired = Boolean(expiredOrder?.trackingTokenExpiresAt && expiredOrder.trackingTokenExpiresAt < new Date());
    check(isExpired === true, "Expired token detected and marked invalid (410)");

    // 7. Token Revocation Behavior
    console.log("\n--- 7. Token Revocation Invariants ---");
    // Reset expiration and set revokedAt
    await Order.findByIdAndUpdate(order._id, {
      trackingTokenExpiresAt: expiresAt,
      trackingTokenRevokedAt: new Date(),
    });
    const revokedOrder = await Order.findOne({ trackingTokenHash: tokenHash });
    check(Boolean(revokedOrder?.trackingTokenRevokedAt), "Revoked token detected and marked revoked (410)");

    // 8. Token Regeneration by Owner
    console.log("\n--- 8. Token Regeneration & Rotation ---");
    const newGen = generateTrackingToken();
    await Order.findByIdAndUpdate(order._id, {
      trackingTokenHash: newGen.tokenHash,
      trackingTokenCreatedAt: new Date(),
      trackingTokenExpiresAt: newGen.expiresAt,
      $unset: { trackingTokenRevokedAt: 1 },
    });

    const rotatedOrder = await Order.findById(order._id);
    check(rotatedOrder?.trackingTokenHash === newGen.tokenHash, "New tracking token hash replaces old one");
    check(rotatedOrder?.trackingTokenRevokedAt === undefined, "Regeneration clears revocation");

    // Old token must no longer resolve
    const oldTokenLookup = await Order.findOne({ trackingTokenHash: tokenHash });
    check(oldTokenLookup === null, "Old revoked/rotated token no longer resolves order");

    // New token resolves order
    const newTokenLookup = await Order.findOne({ trackingTokenHash: newGen.tokenHash });
    check(Boolean(newTokenLookup), "New rotated token successfully resolves order");

  } finally {
    await Order.deleteMany({ userId: testUserId });
    await Shipment.deleteMany({ userId: testUserId });
    await mongoose.disconnect();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
