/**
 * Authentication hardening regression suite.
 *
 * Covers SF-002:
 *  - Production/staging startup fails when ALLOW_AUTH_MOCK or ALLOW_EMAIL_MOCK is true.
 *  - Mock Google users require BOTH a non-production environment and an explicit flag.
 *  - Unsigned/unverifiable Google credentials are always rejected (no payload fallback).
 *  - Password-reset material is never returned in production, even with mock flags set.
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { validateProductionEnv } from "../config/env";
import { forgotPassword, googleAuth } from "../controllers/authController";
import { emailService } from "../services/emailService";
import { User, UserRole, UserStatus } from "../models/User";
import { PasswordResetToken } from "../models/PasswordResetToken";
import { connectSafeTestDb } from "./testHelpers";

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
  status(code: number): MockResponse;
  json(payload: any): MockResponse;
}

function createMockRes(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

async function invoke(
  handler: (req: any, res: any, next: any) => unknown,
  req: Record<string, unknown>
): Promise<{ res: MockResponse; err: any }> {
  const res = createMockRes();
  let captured: any;
  await handler(req, res, (err?: unknown) => {
    captured = err;
  });
  return { res, err: captured };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const MANAGED_ENV = [
  "NODE_ENV",
  "ALLOW_AUTH_MOCK",
  "ALLOW_EMAIL_MOCK",
  "GOOGLE_CLIENT_ID",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "ALLOW_PAYMENT_MOCK",
  "ENABLE_CUSTOM_DESIGN",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of MANAGED_ENV) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of MANAGED_ENV) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

async function expectStartupFailure(
  env: "production" | "staging",
  flag: "ALLOW_AUTH_MOCK" | "ALLOW_EMAIL_MOCK",
  value: string,
  label: string
): Promise<void> {
  process.env.NODE_ENV = env;
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ALLOW_PAYMENT_MOCK = "false";
  process.env.ENABLE_CUSTOM_DESIGN = "false";
  process.env.ALLOW_AUTH_MOCK = "false";
  process.env.ALLOW_EMAIL_MOCK = "false";
  process.env[flag] = value;

  let error: any;
  try {
    validateProductionEnv();
  } catch (err) {
    error = err;
  }
  check(
    error instanceof Error && error.message.includes(`SECURITY_CONFIG_ERROR`) && error.message.includes(flag),
    label,
    error ? error.message : "startup unexpectedly succeeded"
  );
}

async function runTests(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Authentication Mock / Reset-Token Hardening Test Suite      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();
  const originalEnv = snapshotEnv();
  const originalSendReset = emailService.sendPasswordResetEmail;
  let testUserId: string | undefined;

  try {
    // ─────────────────────────────────────────────────────────────
    console.log("[GROUP 1: Fail-closed startup configuration]");
    {
      await expectStartupFailure("production", "ALLOW_AUTH_MOCK", "true", "1.1 production rejects ALLOW_AUTH_MOCK=true");
      await expectStartupFailure("production", "ALLOW_EMAIL_MOCK", "true", "1.2 production rejects ALLOW_EMAIL_MOCK=true");
      await expectStartupFailure("staging", "ALLOW_AUTH_MOCK", "TRUE", "1.3 staging rejects case-insensitive ALLOW_AUTH_MOCK=TRUE");
      await expectStartupFailure("staging", "ALLOW_EMAIL_MOCK", "True", "1.4 staging rejects mixed-case ALLOW_EMAIL_MOCK=True");

      // Non-production keeps developer workflows available.
      process.env.NODE_ENV = "test";
      process.env.ALLOW_AUTH_MOCK = "true";
      process.env.ALLOW_EMAIL_MOCK = "true";
      let devError: any;
      try {
        validateProductionEnv();
      } catch (err) {
        devError = err;
      }
      check(devError === undefined, "1.5 test/development startup is not blocked by the mock flags", devError?.message);
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 2: Google credential handling]");
    {
      const mockUser = { email: "mock-attacker@example.com", name: "Mock Attacker" };

      process.env.NODE_ENV = "production";
      process.env.ALLOW_AUTH_MOCK = "true";
      const prodMock = await invoke(googleAuth, { body: { mockUser } });
      check(
        prodMock.err?.statusCode === 403 && prodMock.err?.code === "FORBIDDEN",
        "2.1 production rejects mockUser even when ALLOW_AUTH_MOCK=true",
        `status=${prodMock.err?.statusCode} code=${prodMock.err?.code}`
      );

      process.env.NODE_ENV = "test";
      delete process.env.ALLOW_AUTH_MOCK;
      const noFlagMock = await invoke(googleAuth, { body: { mockUser } });
      check(
        noFlagMock.err?.statusCode === 403 && noFlagMock.err?.code === "FORBIDDEN",
        "2.2 mockUser requires an explicit ALLOW_AUTH_MOCK opt-in",
        `status=${noFlagMock.err?.statusCode} code=${noFlagMock.err?.code}`
      );

      process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
      const unsignedJwt = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({
        sub: "attacker-sub",
        email: "attacker@example.com",
        email_verified: true,
      })}.`;
      const unsigned = await invoke(googleAuth, { body: { credential: unsignedJwt } });
      check(
        unsigned.err?.statusCode === 401 && unsigned.err?.code === "INVALID_GOOGLE_CREDENTIAL",
        "2.3 unsigned alg=none JWT payload is rejected (no decode-and-trust fallback)",
        `status=${unsigned.err?.statusCode} code=${unsigned.err?.code}`
      );

      const garbage = await invoke(googleAuth, { body: { credential: "not-a-google-token" } });
      check(
        garbage.err?.statusCode === 401 && garbage.err?.code === "INVALID_GOOGLE_CREDENTIAL",
        "2.4 malformed Google credential is rejected",
        `status=${garbage.err?.statusCode} code=${garbage.err?.code}`
      );

      delete process.env.GOOGLE_CLIENT_ID;
      const unconfigured = await invoke(googleAuth, { body: { credential: unsignedJwt } });
      check(
        unconfigured.err?.statusCode === 503 && unconfigured.err?.code === "GOOGLE_AUTH_UNCONFIGURED",
        "2.5 missing GOOGLE_CLIENT_ID fails closed (no unsafe fallback)",
        `status=${unconfigured.err?.statusCode} code=${unconfigured.err?.code}`
      );
    }

    // ─────────────────────────────────────────────────────────────
    console.log("\n[GROUP 3: Password-reset disclosure]");
    {
      const email = `reset-hardening-${Date.now()}@example.com`;
      const user = await User.create({
        name: "Reset Hardening User",
        email,
        passwordHash: await bcrypt.hash("ExistingPassword123!", 10),
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      });
      testUserId = user._id.toString();

      // Keep the suite offline: the notification adapter is not under test here.
      (emailService as any).sendPasswordResetEmail = async () => undefined;

      process.env.NODE_ENV = "production";
      process.env.ALLOW_EMAIL_MOCK = "true";
      const prodReset = await invoke(forgotPassword, { body: { email } });
      check(prodReset.res.statusCode === 200, "3.1 production reset request still returns generic 200");
      check(
        prodReset.res.body?.data === undefined &&
          prodReset.res.body?.resetToken === undefined &&
          !JSON.stringify(prodReset.res.body).includes("resetToken"),
        "3.2 production never returns resetToken/resetUrl, even with ALLOW_EMAIL_MOCK=true",
        JSON.stringify(prodReset.res.body)
      );

      process.env.NODE_ENV = "staging";
      const stagingReset = await invoke(forgotPassword, { body: { email } });
      check(
        stagingReset.res.body?.data === undefined && !JSON.stringify(stagingReset.res.body).includes("resetToken"),
        "3.3 staging never returns reset material",
        JSON.stringify(stagingReset.res.body)
      );

      process.env.NODE_ENV = "test";
      process.env.ALLOW_EMAIL_MOCK = "true";
      const devReset = await invoke(forgotPassword, { body: { email } });
      check(
        typeof devReset.res.body?.data?.resetToken === "string",
        "3.4 development/test explicit mock may return a reset token for local workflows",
        JSON.stringify(devReset.res.body)
      );
    }
  } finally {
    (emailService as any).sendPasswordResetEmail = originalSendReset;
    if (testUserId) {
      await PasswordResetToken.deleteMany({ userId: testUserId });
      await User.deleteOne({ _id: testUserId });
    }
    restoreEnv(originalEnv);
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