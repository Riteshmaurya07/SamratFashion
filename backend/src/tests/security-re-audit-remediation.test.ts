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
import { rateLimit } from "express-rate-limit";
import { UpstashRedisStore } from "../middleware/rateLimitStore";
import { requireAuth } from "../middleware/auth";
import { updateOrderStatus } from "../controllers/adminController";
import { login, refresh, isSameSubnet } from "../controllers/authController";
import { Product, ProductStatus } from "../models/Product";
import { StockReservation, StockReservationStatus } from "../models/StockReservation";
import { InventoryAllocationService } from "../services/inventory/inventoryAllocationService";
import { notificationService } from "../services/notifications/notificationService";

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
  send(payload: any): MockResponse;
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
    send(payload: any) {
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

      // ─────────────────────────────────────────────────────────────────────────
      // N-M8: IP binding on refresh tokens (/24 subnet comparison)
      // ─────────────────────────────────────────────────────────────────────────
      // Test isSameSubnet unit rules
      check(isSameSubnet("203.0.113.10", "203.0.113.45"), "2.7a isSameSubnet: IPv4 same /24 matches");
      check(!isSameSubnet("203.0.113.10", "198.51.100.10"), "2.7b isSameSubnet: IPv4 different /24 rejected");
      check(isSameSubnet("::ffff:192.168.1.10", "192.168.1.55"), "2.7c isSameSubnet: IPv4-mapped IPv6 normalized");
      check(!isSameSubnet("192.168.1.10", "2001:db8::1"), "2.7d isSameSubnet: Protocol family mismatch rejected");

      // Login to get a fresh refresh token session with a known IP
      const ipLoginReq: any = {
        body: { email: user.email, password: rawPassword },
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        ip: "203.0.113.10",
        connection: { remoteAddress: "203.0.113.10" },
      };
      const ipLoginRes = createMockRes();
      await login(ipLoginReq, ipLoginRes as any, () => {});
      const ipRt = ipLoginRes.cookies?.refreshToken?.val;
      check(Boolean(ipRt), "2.8 Fresh login created with IP 203.0.113.10");

      // Same /24 refresh (e.g. mobile IP changed from .10 to .75 within same /24 subnet): succeeds
      const sameSubnetReq: any = {
        cookies: { refreshToken: ipRt },
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        ip: "203.0.113.75",
        connection: { remoteAddress: "203.0.113.75" },
      };
      const sameSubnetRes = createMockRes();
      await refresh(sameSubnetReq, sameSubnetRes as any, () => {});
      check(sameSubnetRes.statusCode === 200, "2.9 Same /24 refresh succeeds with HTTP 200");
      const nextRt = sameSubnetRes.cookies?.refreshToken?.val;
      check(Boolean(nextRt), "2.10 Same /24 refresh issued next rotated refreshToken");

      // Different /24 refresh (attacker from different network 198.51.100.22): revokes family
      let diffIpErr: any = null;
      const diffSubnetReq: any = {
        cookies: { refreshToken: nextRt },
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        ip: "198.51.100.22",
        connection: { remoteAddress: "198.51.100.22" },
      };
      const diffSubnetRes = createMockRes();
      await refresh(diffSubnetReq, diffSubnetRes as any, (err: any) => {
        diffIpErr = err;
      });

      check(
        diffIpErr?.statusCode === 401 && diffIpErr?.code === "SESSION_EXPIRED",
        "2.11 Different /24 refresh is blocked with 401 SESSION_EXPIRED",
        `status=${diffIpErr?.statusCode} code=${diffIpErr?.code}`
      );
      check(
        diffSubnetRes.cookies?.refreshToken === undefined,
        "2.12 Different /24 refresh clears cookies"
      );

      // Verify all sessions in that family are now revoked
      const activeFamilySessions = await Session.find({ userId: user._id, revokedAt: { $exists: false } }).lean();
      check(activeFamilySessions.length === 0, "2.13 Entire refresh token family revoked on IP mismatch");
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
    console.log("\n[TEST GROUP 5: N-H4 AUTH LIMITER FAILS CLOSED & MEMORY FALLBACK]");
    {
      // 5.1 Fail-closed store returns MAX_SAFE_INTEGER by default (RATE_LIMIT_FAIL_CLOSED is unset)
      delete process.env.RATE_LIMIT_FAIL_CLOSED;
      const failClosedStore = new UpstashRedisStore(
        "test:rl:",
        "http://invalid-mock-upstash-url.local",
        "mock_token",
        true
      );

      const result = await failClosedStore.increment("test-ip-key");
      check(
        result.totalHits >= Number.MAX_SAFE_INTEGER,
        "5.1 Fail-closed store returns MAX_SAFE_INTEGER by default when Upstash is unreachable (unset RATE_LIMIT_FAIL_CLOSED)",
        `totalHits=${result.totalHits}`
      );

      // 5.2 Explicit opt-out RATE_LIMIT_FAIL_CLOSED="false" allows in-memory fallback for local dev
      process.env.RATE_LIMIT_FAIL_CLOSED = "false";
      const fallbackStore = new UpstashRedisStore(
        "test:fallback:",
        "http://invalid-mock-upstash-url.local",
        "mock_token",
        true
      );
      const fallbackResult = await fallbackStore.increment("fallback-key");
      check(
        fallbackResult.totalHits === 1,
        "5.2 Fallback store smoothly serves request via in-memory limiter when RATE_LIMIT_FAIL_CLOSED=false",
        `totalHits=${fallbackResult.totalHits}`
      );
      delete process.env.RATE_LIMIT_FAIL_CLOSED;

      // 5.3 Auth rate limiter with unreachable Upstash fails closed returning HTTP 429
      const unreachableAuthLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 5,
        validate: { trustProxy: false },
        store: new UpstashRedisStore(
          "test:auth_endpoint:",
          "http://invalid-mock-upstash-url.local",
          "mock_token",
          true
        ),
        message: {
          success: false,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests, please try again later.",
        },
      });

      const mockReq: any = { ip: "203.0.113.199", headers: {}, app: { get: () => false } };
      const mockRes = createMockRes();
      let nextCalled = false;
      await new Promise<void>((resolve) => {
        const origSend = mockRes.send.bind(mockRes);
        mockRes.send = (payload: any) => {
          origSend(payload);
          resolve();
          return mockRes;
        };
        unreachableAuthLimiter(mockReq, mockRes as any, () => {
          nextCalled = true;
          resolve();
        });
      });

      check(
        mockRes.statusCode === 429 && !nextCalled,
        "5.3 Auth rate limit middleware with unreachable Upstash returns 429 Too Many Requests (fail-closed)",
        `statusCode=${mockRes.statusCode}, nextCalled=${nextCalled}`
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

    // ─────────────────────────────────────────────────────────────────────────
    // 9. N-M16: Stock Reservation on Order Creation
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 9: N-M16 STOCK RESERVATION ON ORDER CREATION]");
    {
      const variantId = new mongoose.Types.ObjectId();
      const product = await Product.create({
        name: `Stock Reservation Item ${testSuffix}`,
        slug: `stock-res-${testSuffix}`,
        description: "Test product for stock reservation concurrency",
        images: ["https://example.com/item.jpg"],
        categoryId: new mongoose.Types.ObjectId(),
        basePrice: 500,
        variants: [
          {
            _id: variantId,
            sku: `SKU-RES-${testSuffix}`,
            size: "M",
            color: "NAVY",
            stock: 1, // Only 1 unit in stock!
            additionalPrice: 0,
            images: [],
            isAvailable: true,
          },
        ],
        tags: ["test"],
        status: ProductStatus.ACTIVE,
        isFeatured: false,
        isNewArrival: false,
        isBestSeller: false,
        freeDelivery: false,
        averageRating: 0,
        reviewCount: 0,
        offers: [],
      });

      const order1Id = new mongoose.Types.ObjectId();
      const order2Id = new mongoose.Types.ObjectId();
      const alloc = {
        productId: product._id as mongoose.Types.ObjectId,
        variantId,
        sku: `SKU-RES-${testSuffix}`,
        size: "M",
        color: "NAVY",
        totalQuantity: 1,
      };

      // Order 1 reserves the last unit
      const resDocs = await InventoryAllocationService.reserveInventoryForOrder(order1Id, [alloc]);
      check(resDocs.length === 1, "9.1 Order 1 reserves the last unit successfully");

      const pAfterRes1 = await Product.findById(product._id).lean();
      const vAfterRes1 = pAfterRes1?.variants.find((v: any) => v._id.toString() === variantId.toString());
      check(vAfterRes1?.stock === 0, "9.2 Variant stock decremented to 0 upon Order 1 reservation");

      const activeRes1 = await StockReservation.findOne({ orderId: order1Id, variantId }).lean();
      check(
        activeRes1?.status === StockReservationStatus.RESERVED,
        "9.3 StockReservation document created with status RESERVED"
      );

      // Order 2 concurrent attempt for the same last unit MUST FAIL at order creation
      let order2Error: any = null;
      try {
        await InventoryAllocationService.reserveInventoryForOrder(order2Id, [alloc]);
      } catch (err: any) {
        order2Error = err;
      }

      check(
        order2Error?.statusCode === 400 && order2Error?.code === "INSUFFICIENT_STOCK",
        "9.4 Order 2 fails at order creation due to insufficient reserved stock (P1 double-sold guard)",
        `status=${order2Error?.statusCode} code=${order2Error?.code}`
      );

      // Order 1 completes payment -> deductInventory confirms reservation and creates SALE ledger
      const deductRes = await InventoryAllocationService.deductInventory(order1Id, [alloc]);
      check(deductRes.success, "9.5 Payment settlement confirms reservation without double-decrementing stock");

      const resAfterCapture = await StockReservation.findOne({ orderId: order1Id, variantId }).lean();
      check(
        resAfterCapture?.status === StockReservationStatus.CONFIRMED,
        "9.6 StockReservation status transitions to CONFIRMED upon payment capture"
      );

      const pAfterCapture = await Product.findById(product._id).lean();
      const vAfterCapture = pAfterCapture?.variants.find((v: any) => v._id.toString() === variantId.toString());
      check(vAfterCapture?.stock === 0, "9.7 Stock remains 0 (no double deduction)");

      // Test release of reservation on cancellation / expiry
      const order3Id = new mongoose.Types.ObjectId();
      await Product.updateOne({ _id: product._id, "variants._id": variantId }, { $set: { "variants.$.stock": 1 } });
      await InventoryAllocationService.reserveInventoryForOrder(order3Id, [alloc]);
      const pAfterRes3 = await Product.findById(product._id).lean();
      check(
        pAfterRes3?.variants.find((v: any) => v._id.toString() === variantId.toString())?.stock === 0,
        "9.8 Order 3 reserved the unit, stock is 0"
      );

      // Release Order 3 reservation
      const releaseRes = await InventoryAllocationService.releaseInventoryReservation(order3Id, "CUSTOMER_CANCELLED");
      check(releaseRes.releasedCount === 1, "9.9 Order 3 reservation released successfully");

      const pAfterRelease3 = await Product.findById(product._id).lean();
      check(
        pAfterRelease3?.variants.find((v: any) => v._id.toString() === variantId.toString())?.stock === 1,
        "9.10 Stock restored to 1 upon Order 3 reservation release"
      );

      // Subsequent duplicate release does not double-restore stock
      const dupRelease = await InventoryAllocationService.releaseInventoryReservation(order3Id, "DUPLICATE_RELEASE");
      check(dupRelease.releasedCount === 0, "9.11 Duplicate release call is idempotent (0 released)");
      const pAfterDupRelease = await Product.findById(product._id).lean();
      check(
        pAfterDupRelease?.variants.find((v: any) => v._id.toString() === variantId.toString())?.stock === 1,
        "9.12 Stock remains exactly 1 (no double restoration leak)"
      );

      await Product.deleteOne({ _id: product._id });
      await StockReservation.deleteMany({ orderId: { $in: [order1Id, order2Id, order3Id] } });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. Item 5: Email Resend Guard — Never Resend Deleted Order's Email
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 10: EMAIL RESEND GUARD FOR DELETED ORDERS]");
    {
      const deletedOrderId = new mongoose.Types.ObjectId();
      const createdOrder = await Order.create({
        _id: deletedOrderId,
        orderNumber: `SF-DEL-${Date.now()}`,
        userId: new mongoose.Types.ObjectId(),
        items: [{
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: "T-Shirt to Delete",
          productImage: "https://example.com/img.jpg",
          selectedSize: "L",
          selectedColor: "WHITE",
          quantity: 2,
          unitPrice: 600,
          lineTotal: 1200,
        }],
        shippingAddress: {
          fullName: "Deleted Order Customer",
          phone: "9123456780",
          addressLine1: "456 Ghost Lane",
          city: "Mumbai",
          state: "Maharashtra",
          postalCode: "400001",
          country: "India",
        },
        subtotal: 1200,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 1200,
        currency: "INR",
        status: "CONFIRMED",
        paymentStatus: "PAID",
      });

      // Create a failed notification log referencing this order
      const notifLog = await NotificationLog.create({
        eventType: "ORDER_CONFIRMED",
        entityType: "ORDER",
        entityId: deletedOrderId,
        recipientEmail: `deleted_order_${testSuffix}@example.com`,
        channel: "EMAIL",
        status: "FAILED",
        provider: "console",
        attemptCount: 1,
        idempotencyKey: `ORDER_CONFIRMED:${deletedOrderId}:fail_test`,
        lastError: "Provider timeout simulation",
        metadata: {
          customerName: "Deleted Order Customer",
          orderNumber: createdOrder.orderNumber,
          total: 1200,
        },
      });

      // Delete the order to simulate test-data cleanup
      await Order.deleteOne({ _id: deletedOrderId });
      const orderExists = await Order.findById(deletedOrderId);
      check(!orderExists, "10.1 Order successfully deleted from database");

      // Attempt to resend notification for the deleted order
      const resendResult = await notificationService.resendNotification(notifLog._id);

      check(
        resendResult.success === false,
        "10.2 Resend of notification for deleted order is REFUSED (success: false)"
      );
      check(
        resendResult.status === "FAILED",
        "10.3 Resend status remains FAILED"
      );
      check(
        resendResult.error?.includes("does not exist or has been deleted") === true,
        "10.4 Resend returns clear error message stating referenced order does not exist or has been deleted",
        `error=${resendResult.error}`
      );

      const updatedLog = await NotificationLog.findById(notifLog._id).lean();
      check(
        updatedLog?.status === "FAILED" && !updatedLog?.sentAt,
        "10.5 NotificationLog was not marked SENT and no email was sent"
      );

      // Now test with an existing order: live data is re-fetched and rendered
      const liveOrderId = new mongoose.Types.ObjectId();
      const liveOrder = await Order.create({
        _id: liveOrderId,
        orderNumber: `SF-LIVE-${Date.now()}`,
        userId: new mongoose.Types.ObjectId(),
        items: [{
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: "Live Order Item",
          productImage: "https://example.com/img.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 1,
          unitPrice: 899,
          lineTotal: 899,
        }],
        shippingAddress: {
          fullName: "Live Customer",
          phone: "9123456789",
          addressLine1: "789 Active Road",
          city: "Pune",
          state: "Maharashtra",
          postalCode: "411001",
          country: "India",
        },
        subtotal: 899,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 899,
        currency: "INR",
        status: "CONFIRMED",
        paymentStatus: "PAID",
      });

      const liveLog = await NotificationLog.create({
        eventType: "ORDER_CONFIRMED",
        entityType: "ORDER",
        entityId: liveOrderId,
        recipientEmail: `live_order_${testSuffix}@example.com`,
        channel: "EMAIL",
        status: "FAILED",
        provider: "console",
        attemptCount: 1,
        idempotencyKey: `ORDER_CONFIRMED:${liveOrderId}:live_test`,
        lastError: "Initial failure",
        metadata: {},
      });

      const liveResend = await notificationService.resendNotification(liveLog._id);
      check(liveResend.success, "10.6 Resend for existing order succeeds");

      const refreshedLog = await NotificationLog.findById(liveLog._id).lean();
      check(
        refreshedLog?.metadata?.orderNumber === liveOrder.orderNumber &&
        refreshedLog?.metadata?.total === 899 &&
        refreshedLog?.metadata?.customerName === "Live Customer",
        "10.7 Live order data was re-fetched and populated into metadata at resend time"
      );

      await Order.deleteOne({ _id: liveOrderId });
      await NotificationLog.deleteMany({ _id: { $in: [notifLog._id, liveLog._id] } });
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
