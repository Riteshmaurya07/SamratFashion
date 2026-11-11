import http from "http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { getJwtAccessSecret } from "../config/env";
import { User, UserRole, UserStatus } from "../models/User";
import { Product } from "../models/Product";
import { Order } from "../models/Order";
import { Address } from "../models/Address";
import { Cart } from "../models/Cart";
import { Shipment } from "../models/Shipment";

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

// Typed promise resolver helper for environments without ES2024 lib types
function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  const { promise, resolve, reject } = withResolvers<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: any;
  }>();

  const url = new URL(path, serverUrl);
  const postData = body ? JSON.stringify(body) : "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (body) {
    headers["Content-Length"] = Buffer.byteLength(postData).toString();
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const req = http.request(
    url,
    {
      method,
      headers,
    },
    (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let parsedBody = null;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          parsedBody = raw;
        }
        resolve({ status: res.statusCode || 500, headers: res.headers, body: parsedBody });
      });
    }
  );

  req.on("error", reject);
  if (body) {
    req.write(postData);
  }
  req.end();

  return promise;
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("HTTP INTEGRATION TESTS: ALTERNATE PHONE & TRACKING");
  console.log("=======================================================\n");

  await connectSafeTestDb();

  // Spin up an ephemeral HTTP server on a random port
  const server = http.createServer(app);
  const { promise: serverListening, resolve: resolveServer } = withResolvers<void>();
  server.listen(0, () => resolveServer());
  await serverListening;
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const jwtSecret = getJwtAccessSecret();

  // Create two distinct users to verify cross-user isolation
  const ownerId = new mongoose.Types.ObjectId();
  const strangerId = new mongoose.Types.ObjectId();

  const ownerToken = jwt.sign({ sub: ownerId.toString(), role: UserRole.CUSTOMER }, jwtSecret, { algorithm: "HS256", expiresIn: "1h" });
  const strangerToken = jwt.sign({ sub: strangerId.toString(), role: UserRole.CUSTOMER }, jwtSecret, { algorithm: "HS256", expiresIn: "1h" });
  try {
    // Cleanup prior remnants
    await User.deleteMany({ _id: { $in: [ownerId, strangerId] } });
    await Address.deleteMany({ userId: { $in: [ownerId, strangerId] } });
    await Order.deleteMany({ userId: { $in: [ownerId, strangerId] } });
    await Cart.deleteMany({ userId: { $in: [ownerId, strangerId] } });

    await User.create({ _id: ownerId, name: "Owner User", email: `owner_${Date.now()}@example.com`, passwordHash: "password123", role: UserRole.CUSTOMER, status: UserStatus.ACTIVE, emailVerified: true });
    await User.create({ _id: strangerId, name: "Stranger User", email: `stranger_${Date.now()}@example.com`, passwordHash: "password123", role: UserRole.CUSTOMER, status: UserStatus.ACTIVE, emailVerified: true });

    // ─────────────────────────────────────────────────────────────
    // 1. Address HTTP API: Alternate Phone Normalization & Validation
    // ─────────────────────────────────────────────────────────────
    console.log("--- 1. Address HTTP Endpoint Tests ---");

    // 1.1 Valid address with alternate phone
    const resAddr1 = await request(baseUrl, "POST", "/api/addresses", {
      fullName: "Pooja Verma",
      phone: "+91 9876543210",
      alternatePhone: "08765432109",
      addressLine1: "Suite 101, Tech Towers",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
      addressType: "WORK",
    }, ownerToken);

    check(resAddr1.status === 201, "HTTP 201: Address created successfully with alternate phone");
    check(resAddr1.body?.data?.phone === "9876543210", "HTTP: Primary phone normalized to 10 digits");
    check(resAddr1.body?.data?.alternatePhone === "8765432109", "HTTP: Alternate phone normalized to 10 digits");
    const validAddressId = resAddr1.body?.data?._id;

    // 1.2 Invalid alternate phone format rejected via HTTP
    const resAddr2 = await request(baseUrl, "POST", "/api/addresses", {
      fullName: "Pooja Verma",
      phone: "9876543210",
      alternatePhone: "12345",
      addressLine1: "Suite 101, Tech Towers",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
    }, ownerToken);
    check(resAddr2.status === 400, "HTTP 400: Rejects invalid alternate mobile length");

    // 1.3 Alternate phone identical to primary rejected via HTTP
    const resAddr3 = await request(baseUrl, "POST", "/api/addresses", {
      fullName: "Pooja Verma",
      phone: "9876543210",
      alternatePhone: "9876543210",
      addressLine1: "Suite 101, Tech Towers",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
    }, ownerToken);
    check(resAddr3.status === 400, "HTTP 400: Rejects alternate phone identical to primary");

    // ─────────────────────────────────────────────────────────────
    // 2. Order Creation & Snapshot Persistence
    // ─────────────────────────────────────────────────────────────
    console.log("\n--- 2. Order Creation & Snapshot Persistence ---");
    const { product, variantIds } = await createTestProduct({
      name: "Streetwear Boxy Hoodie",
      basePrice: 1899,
      variants: [{ size: "L", color: "Jet Black", stock: 10, additionalPrice: 0 }],
    });
    const variantId = variantIds[0];

    // Put item in cart
    await Cart.create({
      userId: ownerId,
      items: [
        {
          productId: product._id,
          variantId: new mongoose.Types.ObjectId(variantId),
          quantity: 1,
        },
      ],
    });

    // Place order via HTTP
    const resOrder = await request(baseUrl, "POST", "/api/orders", {
      addressId: validAddressId,
      idempotencyKey: `idemp_${Date.now()}`,
    }, ownerToken);

    check(resOrder.status === 201, "HTTP 201: Order created successfully");
    check(resOrder.body?.data?.shippingAddress?.alternatePhone === "8765432109", "HTTP: Order snapshot contains alternatePhone");
    check(typeof resOrder.body?.data?.shareableTrackingToken === "string", "HTTP: Order response returns shareableTrackingToken for owner");
    check(resOrder.body?.data?.shareableTrackingToken.length === 64, "HTTP: shareableTrackingToken has 256 bits of entropy (64 hex chars)");

    const orderId = resOrder.body?.data?._id;
    const rawTrackingToken = resOrder.body?.data?.shareableTrackingToken;

    // Attach shipment with trusted carrier
    await Shipment.create({
      orderId,
      userId: ownerId,
      carrier: "Delhivery Express",
      trackingNumber: "DEL-7788990011",
      awbNumber: "DEL-7788990011",
      provider: "delhivery",
      trackingUrl: "https://track.delhivery.com/p/DEL-7788990011",
      status: "IN_TRANSIT",
      packageDetails: { weightGrams: 500, lengthCm: 30, widthCm: 25, heightCm: 5 },
      createdBy: ownerId,
      updatedBy: ownerId,
    });

    // ─────────────────────────────────────────────────────────────
    // 3. Public Order Tracking HTTP Endpoint (Unauthenticated)
    // ─────────────────────────────────────────────────────────────
    console.log("\n--- 3. Public Tracking Endpoint Tests ---");

    // 3.1 Unauthenticated call with valid token succeeds
    const resPublic = await request(baseUrl, "GET", `/api/orders/public-track/${rawTrackingToken}`);
    check(resPublic.status === 200, "HTTP 200: Public tracking reachable without authentication");

    // 3.2 Security headers verified on HTTP wire
    check(resPublic.headers["cache-control"]?.includes("no-store") === true, "Header: Cache-Control contains no-store");
    check(resPublic.headers["x-robots-tag"] === "noindex, nofollow", "Header: X-Robots-Tag is noindex, nofollow");
    check(resPublic.headers["referrer-policy"] === "no-referrer", "Header: Referrer-Policy is no-referrer");

    // 3.3 Privacy & Data Sanitization check
    const pubData = resPublic.body?.data;
    check(pubData?.orderNumber?.startsWith("SF-"), "Public DTO contains orderNumber");
    check(pubData?.recipient?.maskedName === "Pooja V.", "Public DTO masks recipient name (Pooja V.)");
    check(pubData?.recipient?.destinationCity === "Bengaluru", "Public DTO includes destinationCity");
    check(pubData?.recipient?.destinationState === "Karnataka", "Public DTO includes destinationState");
    check(pubData?.shipment?.carrier === "Delhivery Express", "Public DTO includes shipment carrier");
    check(pubData?.shipment?.trackingUrl?.startsWith("https://track.delhivery.com/"), "Trusted HTTPS courier URL preserved");

    // Sensitive field omission verified
    check(pubData?.shippingAddress === undefined, "Zero leakage: Full shipping address omitted");
    check(pubData?.phone === undefined, "Zero leakage: Primary phone omitted");
    check(pubData?.alternatePhone === undefined, "Zero leakage: Alternate phone omitted");
    check(pubData?.email === undefined, "Zero leakage: Email omitted");
    check(pubData?.total === undefined, "Zero leakage: Order total omitted");
    check(pubData?.paymentMethod === undefined, "Zero leakage: Payment method omitted");

    // 3.4 Invalid token rejected via HTTP
    const resInvalid = await request(baseUrl, "GET", `/api/orders/public-track/${"b".repeat(64)}`);
    check(resInvalid.status === 404, "HTTP 404: Unrecognized token returns generic 404");

    // 3.5 Malformed token rejected via HTTP
    const resMalformed = await request(baseUrl, "GET", `/api/orders/public-track/malformed-short-token`);
    check(resMalformed.status === 404, "HTTP 404: Malformed non-hex token returns generic 404");

    // ─────────────────────────────────────────────────────────────
    // 4. Token Revocation & Expiration Lifecycle via HTTP
    // ─────────────────────────────────────────────────────────────
    console.log("\n--- 4. Token Revocation & Regeneration Lifecycle ---");

    // 4.1 Stranger cannot revoke owner's token
    const resStrangerRevoke = await request(baseUrl, "POST", `/api/orders/${orderId}/tracking-token/revoke`, {}, strangerToken);
    check(resStrangerRevoke.status === 404, "HTTP 404: Stranger cannot revoke another customer's tracking link");

    // 4.2 Owner revokes token
    const resOwnerRevoke = await request(baseUrl, "POST", `/api/orders/${orderId}/tracking-token/revoke`, {}, ownerToken);
    check(resOwnerRevoke.status === 200, "HTTP 200: Owner successfully revokes tracking token");

    // 4.3 Public lookup on revoked token returns 410 Gone
    const resRevokedLookup = await request(baseUrl, "GET", `/api/orders/public-track/${rawTrackingToken}`);
    check(resRevokedLookup.status === 410, "HTTP 410: Public lookup on revoked token returns 410 TRACKING_REVOKED");
    check(resRevokedLookup.body?.code === "TRACKING_REVOKED", "Response code confirms TRACKING_REVOKED");

    // 4.4 Owner regenerates token
    const resRegen = await request(baseUrl, "POST", `/api/orders/${orderId}/tracking-token/regenerate`, {}, ownerToken);
    check(resRegen.status === 200, "HTTP 200: Owner successfully regenerates fresh tracking token");
    check(resRegen.body?.success === true, "HTTP: Regenerate response advertises success: true for clients");
    const newRawToken = resRegen.body?.data?.trackingToken;
    check(typeof newRawToken === "string" && newRawToken.length === 64, "New token has 256 bits of entropy");
    check(newRawToken !== rawTrackingToken, "New token is rotated and distinct from old token");

    // 4.5 Old revoked token still fails
    const resOldLookup = await request(baseUrl, "GET", `/api/orders/public-track/${rawTrackingToken}`);
    check(resOldLookup.status === 404, "HTTP 404: Old token hash no longer resolves after regeneration");

    // 4.6 New rotated token resolves successfully
    const resNewLookup = await request(baseUrl, "GET", `/api/orders/public-track/${newRawToken}`);
    check(resNewLookup.status === 200, "HTTP 200: New regenerated token resolves public tracking data");

    // ─────────────────────────────────────────────────────────────
    // 5. Existing Private Order Route Authorization Intact
    // ─────────────────────────────────────────────────────────────
    console.log("\n--- 5. Private Order Authorization Guard Checks ---");

    // Unauthenticated GET /api/orders/:id returns 401
    const resPrivateUnauth = await request(baseUrl, "GET", `/api/orders/${orderId}`);
    check(resPrivateUnauth.status === 401, "HTTP 401: Unauthenticated request to /api/orders/:id is blocked");

    // Stranger GET /api/orders/:id returns 404
    const resPrivateStranger = await request(baseUrl, "GET", `/api/orders/${orderId}`, undefined, strangerToken);
    check(resPrivateStranger.status === 404, "HTTP 404: Stranger cannot access private order data");

    // Owner GET /api/orders/:id returns 200
    const resPrivateOwner = await request(baseUrl, "GET", `/api/orders/${orderId}`, undefined, ownerToken);
    check(resPrivateOwner.status === 200, "HTTP 200: Owner accesses complete private order data");
    check(resPrivateOwner.body?.data?.hasActiveTrackingToken === true, "Owner response indicates hasActiveTrackingToken: true");
    check(resPrivateOwner.body?.data?.trackingTokenHash === undefined, "Owner response never exposes internal trackingTokenHash");

    // Clean up created entities
    await Product.findByIdAndDelete(product._id);
  } finally {
    server.close();
    await Address.deleteMany({ userId: { $in: [ownerId, strangerId] } });
    await Order.deleteMany({ userId: { $in: [ownerId, strangerId] } });
    await User.deleteMany({ _id: { $in: [ownerId, strangerId] } });
    await mongoose.disconnect();
  }

  console.log(`\nHTTP Integration Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error("HTTP Integration test runner error:", err);
  process.exit(1);
});
