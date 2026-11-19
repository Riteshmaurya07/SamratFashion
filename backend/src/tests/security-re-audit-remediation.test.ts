/**
 * Security Re-Audit Remediation Verification Suite
 *
 * Verifies fixes for:
 *  - N-C1: Plaintext reset / verification tokens and OTPs in NotificationLog.idempotencyKey stripped; admin API allowlist
 *  - N-H1: Immediate refresh token family revocation on revoked token reuse (no grace window minting)
 *  - N-H2: Access token stripped from JSON bodies of auth responses (cookie-only)
 *  - N-H3: Persistent DB account lockout after 5 consecutive failed login attempts
 *  - N-H4: Auth rate limiters fail-closed on Upstash store errors
 *  - N-M9: Write endpoints blocked for unverified accounts in requireAuth
 *  - N-M10: TokenVersion invalidation on User
 *  - N-M14: Unpaid orders blocked from transition to CONFIRMED
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { connectSafeTestDb } from "./testHelpers";
import { getJwtAccessSecret } from "../config/env";
import { User, UserRole, UserStatus } from "../models/User";
import { Session } from "../models/Session";
import { NotificationLog } from "../models/NotificationLog";
import { Order } from "../models/Order";
import { emailService } from "../services/emailService";
import { getAdminNotifications } from "../controllers/adminOperationsController";
import { UpstashRedisStore } from "../middleware/rateLimitStore";
import { requireAuth } from "../middleware/auth";
import { updateOrderStatus } from "../controllers/adminController";
import { login, refresh } from "../controllers/authController";

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
  body: any;
  cookies: Record<string, { val: string; options: any }>;
  headers: Record<string, string>;
  status(code: number): MockResponse;
  json(payload: any): MockResponse;
  cookie(name: string, val: string, options: any): MockResponse;
  clearCookie(name: string, options?: any): MockResponse;
  setHeader(name: string, val: string): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    cookies: {},
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    cookie(name: string, val: string, options: any) {
      this.cookies[name] = { val, options };
      return this;
    },
    clearCookie(name: string, options?: any) {
      delete this.cookies[name];
      return this;
    },
    setHeader(name: string, val: string) {
      this.headers[name] = val;
      return this;
    },
  };
  return res;
}

async function runTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║     Security Re-Audit Remediation Verification Suite           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();

  const testSuffix = `remediation_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. N-C1: NotificationLog Idempotency Key & Admin API Token Sanitization
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: N-C1 NOTIFICATION IDEMPOTENCY KEY & ADMIN SANITIZATION]");
    {
      const rawSecretToken = "supersecret_reset_token_0123456789abcdef";
      const rawSecretOtp = "987654";
      const testEmail = `nc1_${testSuffix}@example.com`;
      const validUserId = new mongoose.Types.ObjectId().toString();

      await emailService.sendPasswordResetEmail(
        testEmail,
        rawSecretToken,
        validUserId
      );
      await emailService.sendVerificationEmail(
        testEmail,
        rawSecretOtp,
        rawSecretToken,
        validUserId,
        "Test User"
      );

      const logs = await NotificationLog.find({ recipientEmail: testEmail }).lean();
      check(logs.length >= 2, "1.1 Notification logs created for email events");

      for (const log of logs) {
        check(
          !log.idempotencyKey.includes(rawSecretToken),
          `1.2 idempotencyKey must not contain raw secret token (key: ${log.idempotencyKey})`
        );
        check(
          !log.idempotencyKey.includes(rawSecretOtp),
          `1.3 idempotencyKey must not contain raw OTP (key: ${log.idempotencyKey})`
        );
      }

      // Check Admin API serialization
      const adminReq: any = {
        query: { eventType: "PASSWORD_RESET_REQUESTED" },
        headers: {},
      };
      const adminRes = createMockRes();
      await getAdminNotifications(adminReq, adminRes as any, () => {});

      check(adminRes.statusCode === 200, "1.4 Admin notifications endpoint returns 200");
      const returnedNotifications = adminRes.body?.data?.items || [];
      check(returnedNotifications.length > 0, "1.5 Notifications returned to admin");
      for (const item of returnedNotifications) {
        check(item.idempotencyKey === undefined, "1.6 Admin notification item strips idempotencyKey");
        check(item.metadata === undefined, "1.7 Admin notification item strips metadata");
        check(
          !JSON.stringify(item).includes(rawSecretToken),
          "1.8 Serialized admin notification response contains no raw token"
        );
        check(
          !JSON.stringify(item).includes(rawSecretOtp),
          "1.9 Serialized admin notification response contains no raw OTP"
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. N-H1: Immediate Refresh Token Family Revocation on Revoked Token Reuse
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: N-H1 REFRESH TOKEN REUSE DETECTION (NO GRACE MINTING)]");
    {
      const rawPassword = "ValidPassword123!";
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      const user = await User.create({
        name: "Refresh Token Victim",
        email: `nh1_${testSuffix}@example.com`,
        passwordHash: hashedPassword,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      });

      // Login to get initial refresh token
      const loginReq: any = {
        body: { email: user.email, password: rawPassword },
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        ip: "127.0.0.1",
        connection: { remoteAddress: "127.0.0.1" },
      };
      const loginRes = createMockRes();
      await login(loginReq, loginRes as any, () => {});

      const initialRt = loginRes.cookies?.refreshToken?.val;
      check(Boolean(initialRt), "2.1 Initial login yields a refreshToken cookie");

      // First refresh: rotates RT1 -> RT2
      const refreshReq1: any = {
        cookies: { refreshToken: initialRt },
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        ip: "127.0.0.1",
        connection: { remoteAddress: "127.0.0.1" },
      };
      const refreshRes1 = createMockRes();
      await refresh(refreshReq1, refreshRes1 as any, () => {});
      check(refreshRes1.statusCode === 200, "2.2 First refresh succeeds with HTTP 200");
      const rotatedRt = refreshRes1.cookies?.refreshToken?.val;
      check(Boolean(rotatedRt) && rotatedRt !== initialRt, "2.3 Refresh minted a new rotated token");

      // Attacker replays revoked RT1 within grace period
      let capturedError: any = null;
      const replayReq: any = {
        cookies: { refreshToken: initialRt },
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        ip: "127.0.0.1",
        connection: { remoteAddress: "127.0.0.1" },
      };
      const replayRes = createMockRes();
      await refresh(replayReq, replayRes as any, (err: any) => {
        capturedError = err;
      });

      check(
        capturedError?.statusCode === 401 && (capturedError?.code === "SESSION_EXPIRED" || capturedError?.code === "REFRESH_TOKEN_REUSED"),
        "2.4 Replaying revoked refresh token immediately fails with 401 SESSION_EXPIRED / REFRESH_TOKEN_REUSED",
        `status=${capturedError?.statusCode} code=${capturedError?.code}`
      );
      check(
        replayRes.cookies?.refreshToken === undefined,
        "2.5 Replaying revoked refresh token does NOT mint a new token"
      );

      // Verify the whole token family is revoked in the Session collection
      const activeSessions = await Session.find({ userId: user._id, revokedAt: { $exists: false } }).lean();
      check(
        activeSessions.length === 0,
        "2.6 Entire refresh token family is revoked upon reuse detection"
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. N-H2: Access Token Omitted from JSON Auth Bodies (Cookie-Only)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: N-H2 ACCESS TOKEN STRIPPED FROM JSON BODIES]");
    {
      const rawPassword = "ValidPassword123!";
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      const user = await User.create({
        name: "Cookie Only User",
        email: `nh2_${testSuffix}@example.com`,
        passwordHash: hashedPassword,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      });

      const loginReq: any = {
        body: { email: user.email, password: rawPassword },
        headers: { "user-agent": "Mozilla/5.0" },
        ip: "127.0.0.1",
        connection: { remoteAddress: "127.0.0.1" },
      };
      const loginRes = createMockRes();
      await login(loginReq, loginRes as any, () => {});

      check(loginRes.statusCode === 200, "3.1 Login returns 200");
      check(loginRes.body?.accessToken === undefined, "3.2 No accessToken at root of response body");
      check(loginRes.body?.data?.accessToken === undefined, "3.3 No accessToken in body.data");
      check(Boolean(loginRes.cookies?.accessToken?.val), "3.4 accessToken is delivered in httpOnly cookie");

      // Verify refresh also does not return accessToken in body
      const rt = loginRes.cookies?.refreshToken?.val;
      const refReq: any = {
        cookies: { refreshToken: rt },
        headers: { "user-agent": "Mozilla/5.0" },
        ip: "127.0.0.1",
        connection: { remoteAddress: "127.0.0.1" },
      };
      const refRes = createMockRes();
      await refresh(refReq, refRes as any, () => {});
      check(refRes.statusCode === 200, "3.5 Refresh returns 200");
      check(refRes.body?.accessToken === undefined, "3.6 No accessToken at root of refresh response body");
      check(refRes.body?.data?.accessToken === undefined, "3.7 No accessToken in refresh body.data");
      check(Boolean(refRes.cookies?.accessToken?.val), "3.8 accessToken rotated via httpOnly cookie");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. N-H3: Persistent DB Account Lockout
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: N-H3 PERSISTENT ACCOUNT LOCKOUT]");
    {
      const correctPassword = "CorrectPassword123!";
      const hashedPassword = await bcrypt.hash(correctPassword, 10);
      const user = await User.create({
        name: "Lockout Test User",
        email: `nh3_${testSuffix}@example.com`,
        passwordHash: hashedPassword,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        failedLoginAttempts: 0,
      });

      const wrongReq = (pwd: string) => ({
        body: { email: user.email, password: pwd },
        headers: {},
        ip: "127.0.0.1",
        connection: { remoteAddress: "127.0.0.1" },
      });

      // Submit 5 failed attempts
      for (let i = 1; i <= 5; i++) {
        await login(wrongReq("WrongPassword123!") as any, createMockRes() as any, () => {});
      }

      // Check persistent counter in DB
      const lockedUser = await User.findById(user._id).lean();
      check(lockedUser?.failedLoginAttempts === 5, "4.1 User failedLoginAttempts counter reached 5 in DB");
      check(
        Boolean(lockedUser?.lockedUntil && new Date(lockedUser.lockedUntil) > new Date()),
        "4.2 User lockedUntil timestamp is set in the future"
      );

      // 6th attempt (even with correct password) must be rejected with 423
      let lockError: any = null;
      await login(wrongReq(correctPassword) as any, createMockRes() as any, (e: any) => { lockError = e; });
      check(
        lockError?.statusCode === 423 && lockError?.code === "ACCOUNT_LOCKED",
        "4.3 Locked account rejects subsequent login with HTTP 423 ACCOUNT_LOCKED",
        `status=${lockError?.statusCode} code=${lockError?.code}`
      );

      // Clear lockout manually in DB to test unlock on success
      await User.updateOne({ _id: user._id }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });

      const unlockRes = createMockRes();
      await login(wrongReq(correctPassword) as any, unlockRes as any, () => {});
      check(unlockRes.statusCode === 200, "4.4 Login with correct password after lock expires succeeds");

      const unlockedUser = await User.findById(user._id).lean();
      check(
        unlockedUser?.failedLoginAttempts === 0 && !unlockedUser?.lockedUntil,
        "4.5 Successful login resets failedLoginAttempts and lockedUntil to clean state"
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. N-H4: Auth Rate Limiter Fail-Closed
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 5: N-H4 AUTH LIMITER FAILS CLOSED]");
    {
      const failClosedStore = new UpstashRedisStore(
        "test:rl:",
        "http://invalid-mock-upstash-url.local",
        "mock_token",
        true
      );

      const result = await failClosedStore.increment("test-ip-key");
      check(
        result.totalHits >= Number.MAX_SAFE_INTEGER,
        "5.1 Fail-closed store returns MAX_SAFE_INTEGER on store error, denying request",
        `totalHits=${result.totalHits}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. N-M9: requireAuth Gates Write Operations for Unverified Accounts
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 6: N-M9 WRITE ENDPOINTS GATED ON EMAIL VERIFICATION]");
    {
      const rawPassword = "ValidPassword123!";
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      const unverifiedUser = await User.create({
        name: "Unverified User",
        email: `nm9_${testSuffix}@example.com`,
        passwordHash: hashedPassword,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: false,
      });

      const secret = getJwtAccessSecret();
      const token = jwt.sign(
        { sub: unverifiedUser._id.toString(), role: unverifiedUser.role, tokenVersion: 0 },
        secret
      );

      // GET request from unverified account is permitted
      let getError: any = null;
      const getReq: any = {
        method: "GET",
        originalUrl: "/api/orders",
        headers: { authorization: `Bearer ${token}` },
        cookies: {},
      };
      await requireAuth(getReq, createMockRes() as any, (e?: any) => { getError = e; });
      check(!getError, "6.1 Read operation (GET) is permitted for unverified user");

      // POST request from unverified account is blocked with 403 EMAIL_NOT_VERIFIED
      let postError: any = null;
      const postReq: any = {
        method: "POST",
        originalUrl: "/api/orders",
        headers: { authorization: `Bearer ${token}` },
        cookies: {},
      };
      await requireAuth(postReq, createMockRes() as any, (e?: any) => { postError = e; });
      check(
        postError?.statusCode === 403 && postError?.code === "EMAIL_NOT_VERIFIED",
        "6.2 Write operation (POST) is rejected with 403 EMAIL_NOT_VERIFIED",
        `status=${postError?.statusCode} code=${postError?.code}`
      );

      // Verification endpoint itself is exempted
      let verifyEndpointError: any = null;
      const verifyReq: any = {
        method: "POST",
        originalUrl: "/api/auth/verify-email",
        headers: { authorization: `Bearer ${token}` },
        cookies: {},
      };
      await requireAuth(verifyReq, createMockRes() as any, (e?: any) => { verifyEndpointError = e; });
      check(!verifyEndpointError, "6.3 Verification endpoint (/api/auth/verify-email) is exempted from the gate");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. N-M10: TokenVersion Invalidation in JWT
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 7: N-M10 TOKEN VERSION INVALIDATION]");
    {
      const rawPassword = "ValidPassword123!";
      const hashedPassword = await bcrypt.hash(rawPassword, 10);
      const user = await User.create({
        name: "Token Version User",
        email: `nm10_${testSuffix}@example.com`,
        passwordHash: hashedPassword,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        tokenVersion: 1, // User is at version 1
      });

      const secret = getJwtAccessSecret();
      // Mint token with older tokenVersion 0
      const staleToken = jwt.sign(
        { sub: user._id.toString(), role: user.role, tokenVersion: 0 },
        secret
      );

      let staleAuthError: any = null;
      const req: any = {
        method: "GET",
        originalUrl: "/api/account",
        headers: { authorization: `Bearer ${staleToken}` },
        cookies: {},
      };
      await requireAuth(req, createMockRes() as any, (e?: any) => { staleAuthError = e; });
      check(
        staleAuthError?.statusCode === 401,
        "7.1 Token with stale tokenVersion is rejected with 401",
        `status=${staleAuthError?.statusCode} code=${staleAuthError?.code}`
      );

      // Mint token with current tokenVersion 1
      const validToken = jwt.sign(
        { sub: user._id.toString(), role: user.role, tokenVersion: 1 },
        secret
      );
      let validAuthError: any = null;
      const validReq: any = {
        method: "GET",
        originalUrl: "/api/account",
        headers: { authorization: `Bearer ${validToken}` },
        cookies: {},
      };
      await requireAuth(validReq, createMockRes() as any, (e?: any) => { validAuthError = e; });
      check(!validAuthError, "7.2 Token with matching tokenVersion succeeds");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. N-M14: Unpaid Orders Cannot Transition to CONFIRMED
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 8: N-M14 UNPAID ORDERS BLOCKED FROM CONFIRMED]");
    {
      const order = await Order.create({
        orderNumber: `NM14-${Date.now()}`,
        userId: new mongoose.Types.ObjectId(),
        items: [{
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: "Test Item",
          productImage: "https://example.com/item.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500,
        }],
        shippingAddress: {
          fullName: "Test Customer",
          phone: "9876543210",
          addressLine1: "123 Test St",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560001",
          country: "India",
        },
        subtotal: 500,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 500,
        currency: "INR",
        status: "PENDING",
        paymentStatus: "PENDING", // Unpaid!
      });

      const adminUserId = new mongoose.Types.ObjectId().toString();
      const updateReq: any = {
        params: { id: order._id.toString() },
        body: { status: "CONFIRMED" },
        user: { id: adminUserId, role: "ADMIN" },
      };

      const unpaidRes = createMockRes();
      await updateOrderStatus(updateReq, unpaidRes as any);

      check(
        unpaidRes.statusCode === 400 && unpaidRes.body?.message?.includes("Payment must be confirmed"),
        "8.1 Transitioning unpaid order to CONFIRMED is rejected with 400 ORDER_UNPAID",
        `status=${unpaidRes.statusCode} message=${unpaidRes.body?.message}`
      );

      // Set order paymentStatus to PAID and retry transition
      await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: "PAID" } });
      const successRes = createMockRes();
      await updateOrderStatus(updateReq, successRes as any);
      check(successRes.statusCode === 200, "8.2 Transitioning PAID order to CONFIRMED succeeds with HTTP 200");

      const confirmedOrder = await Order.findById(order._id).lean();
      check(confirmedOrder?.status === "CONFIRMED", "8.3 Order status in DB is now CONFIRMED");
    }

  } finally {
    await User.deleteMany({ email: new RegExp(testSuffix) });
    await NotificationLog.deleteMany({ recipientEmail: new RegExp(testSuffix) });
    await Session.deleteMany({});
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════════");

  if (failed > 0) {
    console.error("Failures:\n" + failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
