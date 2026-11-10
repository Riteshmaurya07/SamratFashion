import http from "http";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { connectSafeTestDb } from "./testHelpers";
import { getJwtAccessSecret } from "../config/env";
import { User, UserRole, UserStatus } from "../models/User";

let passed = 0;
let failed = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failed++;
  }
}

function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HttpResponse {
  status: number;
  body: any;
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<HttpResponse> {
  const { promise, resolve, reject } = withResolvers<HttpResponse>();
  const url = new URL(path, serverUrl);
  const headers: Record<string, string> = {};
  let payload = "";

  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const req = http.request(url, { method, headers }, (res) => {
    let resData = "";
    res.on("data", (chunk) => {
      resData += chunk;
    });
    res.on("end", () => {
      try {
        const parsed = resData ? JSON.parse(resData) : null;
        resolve({ status: res.statusCode || 500, body: parsed });
      } catch {
        resolve({ status: res.statusCode || 500, body: resData });
      }
    });
  });

  req.on("error", reject);
  if (payload) {
    req.write(payload);
  }
  req.end();
  return promise;
}

async function runAuthVerificationTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Section 2: Authentication & Authorization Verification Suite  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  await connectSafeTestDb();
  const testSuffix = `auth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const secret = getJwtAccessSecret();

  const server = http.createServer(app);
  const { promise: listenPromise, resolve: listenResolve } = withResolvers<void>();
  server.listen(0, () => listenResolve());
  await listenPromise;
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    const rawPassword = "StrongAuthPass123!";
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    // 1. Create dedicated test accounts
    const testAdmin = await new User({
      name: "Dedicated Auth Test Admin",
      email: `admin_test_${testSuffix}@example.com`,
      passwordHash: hashedPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    }).save();

    const testCustomer = await new User({
      name: "Dedicated Auth Test Customer",
      email: `cust_test_${testSuffix}@example.com`,
      passwordHash: hashedPassword,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    }).save();

    const testSuspended = await new User({
      name: "Suspended User",
      email: `suspended_${testSuffix}@example.com`,
      passwordHash: hashedPassword,
      role: UserRole.CUSTOMER,
      status: UserStatus.SUSPENDED,
    }).save();

    // Test 1: Unauthenticated user accessing admin endpoint
    console.log("\n[TEST 1: Unauthenticated Access Guard]");
    const unauthRes = await request(serverUrl, "GET", "/api/admin/orders");
    check(unauthRes.status === 401, "Unauthenticated access rejected with HTTP 401");
    check(unauthRes.body?.code === "UNAUTHORIZED", "Error code is UNAUTHORIZED");

    // Test 2: Real Login Flow via /api/auth/login for Admin
    console.log("\n[TEST 2: Actual Admin Login Flow via /api/auth/login]");
    const adminLoginRes = await request(serverUrl, "POST", "/api/auth/login", {
      email: testAdmin.email,
      password: rawPassword,
    });
    check(adminLoginRes.status === 200, "Admin login succeeds with HTTP 200");
    const adminAccessToken = adminLoginRes.body?.data?.accessToken;
    check(Boolean(adminAccessToken), "Response provides valid accessToken");
    check(adminLoginRes.body?.data?.user?.role === "ADMIN", "Logged-in user role is ADMIN");

    // Test 3: Admin Token accessing Admin Orders Endpoint
    console.log("\n[TEST 3: Admin Access to /api/admin/orders]");
    const adminOrdersRes = await request(serverUrl, "GET", "/api/admin/orders", undefined, adminAccessToken);
    check(adminOrdersRes.status === 200, "Admin receives HTTP 200 on /api/admin/orders");
    check(Array.isArray(adminOrdersRes.body?.data?.items), "Admin receives orders list");

    // Test 4: Real Login Flow via /api/auth/login for Customer & Role Guard (HTTP 403)
    console.log("\n[TEST 4: Customer Login & Admin Endpoint RBAC Enforcement (HTTP 403)]");
    const customerLoginRes = await request(serverUrl, "POST", "/api/auth/login", {
      email: testCustomer.email,
      password: rawPassword,
    });
    check(customerLoginRes.status === 200, "Customer login succeeds with HTTP 200");
    const customerAccessToken = customerLoginRes.body?.data?.accessToken;
    check(Boolean(customerAccessToken), "Customer receives accessToken");

    const customerAccessAdminRes = await request(serverUrl, "GET", "/api/admin/orders", undefined, customerAccessToken);
    check(customerAccessAdminRes.status === 403, "Customer access to /api/admin/orders is rejected with HTTP 403 Forbidden");
    check(
      Boolean(customerAccessAdminRes.body?.code === "FORBIDDEN" || customerAccessAdminRes.body?.message?.includes("Forbidden")),
      "Response confirms FORBIDDEN access"
    );

    // Test 5: Suspended User Login & Access Block
    console.log("\n[TEST 5: Suspended User Access Prevention]");
    const suspendedLoginRes = await request(serverUrl, "POST", "/api/auth/login", {
      email: testSuspended.email,
      password: rawPassword,
    });
    check(suspendedLoginRes.status === 403, "Suspended user login rejected with HTTP 403");
    check(suspendedLoginRes.body?.code === "ACCOUNT_SUSPENDED", "Error code is ACCOUNT_SUSPENDED");

    // Also test active token when user is subsequently suspended
    const tokenForSoonSuspended = jwt.sign(
      { sub: testCustomer._id.toString(), id: testCustomer._id.toString(), role: UserRole.CUSTOMER },
      secret,
      { expiresIn: "1h" }
    );
    await User.updateOne({ _id: testCustomer._id }, { $set: { status: UserStatus.SUSPENDED } });
    const postSuspensionRes = await request(serverUrl, "GET", "/api/admin/orders", undefined, tokenForSoonSuspended);
    check(postSuspensionRes.status === 401, "Token for suspended account immediately rejected on live DB lookup (HTTP 401)");
    check(Boolean(postSuspensionRes.body?.message?.includes("Session is no longer available")), "Error message conceals details from suspended caller");

    // Restore customer to active
    await User.updateOne({ _id: testCustomer._id }, { $set: { status: UserStatus.ACTIVE } });

    // Test 6: Expired and Invalid JWT Rejection
    console.log("\n[TEST 6: Expired & Invalid JWT Rejection]");
    const expiredToken = jwt.sign(
      { sub: testAdmin._id.toString(), id: testAdmin._id.toString(), role: UserRole.ADMIN },
      secret,
      { expiresIn: "-5s" }
    );
    const expiredRes = await request(serverUrl, "GET", "/api/admin/orders", undefined, expiredToken);
    check(expiredRes.status === 401, "Expired token rejected with HTTP 401");
    check(expiredRes.body?.code === "TOKEN_EXPIRED", "Error code is TOKEN_EXPIRED");

    const forgedToken = jwt.sign(
      { sub: testAdmin._id.toString(), id: testAdmin._id.toString(), role: UserRole.ADMIN },
      "completely_wrong_secret_1234567890",
      { expiresIn: "1h" }
    );
    const forgedRes = await request(serverUrl, "GET", "/api/admin/orders", undefined, forgedToken);
    check(forgedRes.status === 401, "Forged token rejected with HTTP 401 UNAUTHORIZED");

    // Clean up test users
    await User.deleteMany({ _id: { $in: [testAdmin._id, testCustomer._id, testSuspended._id] } });
  } finally {
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\nAuth Verification Suite Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAuthVerificationTests().catch((err) => {
  console.error("Auth test execution failed:", err);
  process.exit(1);
});
