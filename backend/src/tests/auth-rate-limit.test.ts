process.env.NODE_ENV = "test";

import http from "http";
import mongoose from "mongoose";
import { app, serverInstance } from "../index";
import { stopOrderExpiryScheduler } from "../services/orderExpiryService";
import { stopLogCleanupScheduler } from "../services/logCleanupService";
import { RecoveryCoordinatorService } from "../services/recovery/recoveryCoordinatorService";
import { connectSafeTestDb } from "./testHelpers";
import { User } from "../models/User";
import { Session } from "../models/Session";
import { EmailVerificationToken } from "../models/EmailVerificationToken";

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

interface HttpResponse {
  status: number;
  body: any;
  headers: http.IncomingHttpHeaders;
}

function request(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const headers: Record<string, string> = {};
    let payload = "";

    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }

    const req = http.request(url, { method, headers }, (res) => {
      let resData = "";
      res.on("data", (chunk) => {
        resData += chunk;
      });
      res.on("end", () => {
        let parsed: any = null;
        try {
          parsed = resData ? JSON.parse(resData) : null;
        } catch {
          parsed = resData;
        }
        resolve({ status: res.statusCode || 500, body: parsed, headers: res.headers });
      });
    });

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runAuthRateLimitTests(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  Auth Rate Limiting: login, per-account lockout, registration     ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝");

  await connectSafeTestDb();
  const testSuffix = `ratelimit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    // ------------------------------------------------------------------
    // 1. Per-account failed-login lockout (5 failures / 15 min)
    // ------------------------------------------------------------------
    console.log("\n[TEST 1: Per-account failed login throttling]");
    const targetEmail = `ratelimit_target_${testSuffix}@example.com`;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await request(serverUrl, "POST", "/api/auth/login", {
        email: targetEmail,
        password: "WrongPassword123!",
      });
      check(res.status === 401, `Attempt ${attempt}/5 with wrong password returns HTTP 401`);
    }

    const accountBlocked = await request(serverUrl, "POST", "/api/auth/login", {
      email: targetEmail,
      password: "WrongPassword123!",
    });
    check(accountBlocked.status === 429, "6th failed attempt on same account returns HTTP 429");
    check(accountBlocked.body?.code === "RATE_LIMIT_EXCEEDED", "Error code is RATE_LIMIT_EXCEEDED");
    check(
      typeof accountBlocked.body?.message === "string" &&
        accountBlocked.body.message.includes("failed login attempts for this account"),
      "Response explains the account lockout"
    );
    check(
      Boolean(accountBlocked.headers["retry-after"]),
      "Retry-After header is present on 429"
    );

    // ------------------------------------------------------------------
    // 2. Per-IP login limiter (10 requests / 15 min). Test 1 already used
    //    6 hits from this IP, so 4 more reach the limit, then the 5th blocks.
    // ------------------------------------------------------------------
    console.log("\n[TEST 2: Per-IP login throttling]");
    for (let attempt = 1; attempt <= 4; attempt++) {
      const email = `ratelimit_ip_${attempt}_${testSuffix}@example.com`;
      const res = await request(serverUrl, "POST", "/api/auth/login", {
        email,
        password: "WrongPassword123!",
      });
      check(res.status === 401, `Distinct-account attempt ${attempt}/4 still returns HTTP 401`);
    }

    const ipBlocked = await request(serverUrl, "POST", "/api/auth/login", {
      email: `ratelimit_ip_final_${testSuffix}@example.com`,
      password: "WrongPassword123!",
    });
    check(ipBlocked.status === 429, "11th login request from same IP returns HTTP 429");
    check(ipBlocked.body?.code === "RATE_LIMIT_EXCEEDED", "Error code is RATE_LIMIT_EXCEEDED");
    check(
      typeof ipBlocked.body?.message === "string" &&
        ipBlocked.body.message.includes("Too many login attempts"),
      "Response explains the IP-level limit"
    );

    // ------------------------------------------------------------------
    // 3. Registration limiter (5 accounts / hour / IP)
    // ------------------------------------------------------------------
    console.log("\n[TEST 3: Registration throttling]");
    for (let attempt = 1; attempt <= 5; attempt++) {
      const email = `ratelimit_register_${attempt}_${testSuffix}@example.com`;
      const res = await request(serverUrl, "POST", "/api/auth/register", {
        name: `Rate Limit Test ${attempt}`,
        email,
        password: "StrongPassword123!",
      });
      check(res.status === 201, `Registration ${attempt}/5 succeeds with HTTP 201`);
    }

    const registerBlocked = await request(serverUrl, "POST", "/api/auth/register", {
      name: "Rate Limit Test Blocked",
      email: `ratelimit_register_blocked_${testSuffix}@example.com`,
      password: "StrongPassword123!",
    });
    check(registerBlocked.status === 429, "6th registration from same IP returns HTTP 429");
    check(registerBlocked.body?.code === "RATE_LIMIT_EXCEEDED", "Error code is RATE_LIMIT_EXCEEDED");
    check(
      typeof registerBlocked.body?.message === "string" &&
        registerBlocked.body.message.includes("Too many accounts"),
      "Response explains the registration limit"
    );
  } finally {
    // Clean up test data created by successful registrations / attempts
    const users = await User.find({ email: { $regex: `_${testSuffix}@example\\.com$` } }).select("_id");
    const userIds = users.map((u) => u._id);
    await Promise.all([
      Session.deleteMany({ userId: { $in: userIds } }),
      EmailVerificationToken.deleteMany({ userId: { $in: userIds } }),
      User.deleteMany({ _id: { $in: userIds } }),
    ]);
    server.close();
    stopOrderExpiryScheduler();
    stopLogCleanupScheduler();
    RecoveryCoordinatorService.stopRecoveryScheduler();
    if (serverInstance) {
      await new Promise<void>((resolve) => (serverInstance as http.Server).close(() => resolve()));
    }
    await mongoose.disconnect();
  }

  console.log(`\nAuth Rate Limiting Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);

}

runAuthRateLimitTests().catch((err) => {
  console.error("Auth rate limit test execution failed:", err);
  process.exit(1);
});
