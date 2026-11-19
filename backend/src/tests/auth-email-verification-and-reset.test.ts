import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import authRoutes from "../routes/authRoutes";
import orderRoutes from "../routes/orderRoutes";
import { User } from "../models/User";
import { PasswordResetToken } from "../models/PasswordResetToken";
import { EmailVerificationToken } from "../models/EmailVerificationToken";
import { emailService } from "../services/emailService";
import { connectSafeTestDb } from "./testHelpers";
import { requireAuth } from "../middleware/auth";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/orders", requireAuth, orderRoutes);

// Error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  const code = err && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : "INTERNAL_ERROR";
  res.status(statusCode).json({
    success: false,
    message,
    code,
  });
});

const sha256Hex = (val: string) => crypto.createHash("sha256").update(val).digest("hex");

async function runAuthVerificationTests() {
  console.log("=== STARTING AUTH & EMAIL VERIFICATION TEST SUITE ===");
  await connectSafeTestDb();

  process.env.ALLOW_EMAIL_MOCK = "true";
  process.env.FRONTEND_URL = "http://localhost:3000";

  let lastSentOtp = "";
  let lastSentToken = "";
  const originalSendVerification = emailService.sendVerificationEmail;
  emailService.sendVerificationEmail = async (email, otp, token, userId, name) => {
    lastSentOtp = otp;
    lastSentToken = token;
    return originalSendVerification.call(emailService, email, otp, token, userId, name);
  };

  const server = app.listen(5099);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const request = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`http://localhost:5099${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json: json as any, headers: res.headers };
  };

  try {
    const testEmail = `verify_user_${Date.now()}@samratfashion.com`;
    const testPassword = "Password123!";

    // --- TEST 1: Registration creates user with emailVerified = false and stores SHA-256 hashed OTP/token ---
    console.log("\n[TEST 1: User Registration & Hashed Token Storage (H1)]");
    const regRes = await request("POST", "/api/auth/register", {
      name: "Verification Customer",
      email: testEmail,
      password: testPassword,
    });

    console.log("Register response:", regRes.status, regRes.json?.message);
    if (regRes.status !== 201) throw new Error(`Register failed with status ${regRes.status}: ${JSON.stringify(regRes.json)}`);
    if (regRes.json?.data?.user?.emailVerified !== false) throw new Error("Expected emailVerified to be false initially");
    if (!regRes.json?.data?.requiresVerification) throw new Error("Expected requiresVerification to be true");

    const createdUser = await User.findOne({ email: testEmail });
    if (!createdUser || createdUser.emailVerified !== false) {
      throw new Error("Database user does not have emailVerified = false");
    }

    const verificationDoc = await EmailVerificationToken.findOne({ email: testEmail, usedAt: { $exists: false } });
    if (!verificationDoc || !verificationDoc.otp || !verificationDoc.token) {
      throw new Error("EmailVerificationToken document was not created");
    }

    // Verify H1: OTP and token are stored as SHA-256 hex hashes (64 chars) at rest
    if (verificationDoc.otp.length !== 64) {
      throw new Error(`OTP length in DB is ${verificationDoc.otp.length}, expected 64-char SHA-256 hex hash`);
    }
    if (verificationDoc.token.length !== 64) {
      throw new Error(`Token length in DB is ${verificationDoc.token.length}, expected 64-char SHA-256 hex hash`);
    }
    if (verificationDoc.otp !== sha256Hex(lastSentOtp)) {
      throw new Error("Stored OTP does not match SHA-256 of dispatched plain OTP");
    }
    if (verificationDoc.token !== sha256Hex(lastSentToken)) {
      throw new Error("Stored token does not match SHA-256 of dispatched plain token");
    }
    if (verificationDoc.failedAttempts !== 0) {
      throw new Error(`Expected failedAttempts=0, got ${verificationDoc.failedAttempts}`);
    }
    console.log("✔ TEST 1 PASSED: Registration stored SHA-256 hashed OTP & token at rest.");

    // --- TEST 2: Verify email with invalid OTP fails and increments failedAttempts ---
    console.log("\n[TEST 2: Verify with Invalid OTP & Counter Increment]");
    const invalidVerifyRes = await request("POST", "/api/auth/verify-email", {
      email: testEmail,
      otp: "000000",
    });
    if (invalidVerifyRes.status !== 400) {
      throw new Error(`Expected 400 for invalid OTP, got ${invalidVerifyRes.status}`);
    }
    const docAfterFail = await EmailVerificationToken.findOne({ email: testEmail, usedAt: { $exists: false } });
    if (!docAfterFail || docAfterFail.failedAttempts !== 1) {
      throw new Error(`Expected failedAttempts=1 after failed attempt, got ${docAfterFail?.failedAttempts}`);
    }
    console.log("✔ TEST 2 PASSED: Invalid OTP rejected cleanly and incremented failedAttempts to 1");

    // --- TEST 2B: 5 failed attempts locks out the token ---
    console.log("\n[TEST 2B: Lockout After 5 Failed Verification Attempts]");
    for (let i = 2; i <= 5; i++) {
      await request("POST", "/api/auth/verify-email", {
        email: testEmail,
        otp: "000000",
      });
    }
    const lockedDoc = await EmailVerificationToken.findOne({ email: testEmail, usedAt: { $exists: false } });
    if (!lockedDoc || lockedDoc.failedAttempts < 5) {
      throw new Error(`Expected failedAttempts >= 5, got ${lockedDoc?.failedAttempts}`);
    }
    const lockedRes = await request("POST", "/api/auth/verify-email", {
      email: testEmail,
      otp: lastSentOtp, // even correct OTP should be rejected once locked
    });
    if (lockedRes.status !== 400 || lockedRes.json?.code !== "VERIFICATION_LOCKED") {
      throw new Error(`Expected 400 VERIFICATION_LOCKED, got ${lockedRes.status} ${JSON.stringify(lockedRes.json)}`);
    }
    console.log("✔ TEST 2B PASSED: Verification locked after 5 failed attempts");

    // Request fresh code for testEmail to proceed with tests
    await request("POST", "/api/auth/resend-verification", { email: testEmail });
    const freshOtp = lastSentOtp;

    // --- TEST 3: Verify email with valid raw OTP succeeds (hash-then-compare) ---
    console.log("\n[TEST 3: Verify with Valid OTP (Hash-Then-Compare)]");
    const validVerifyRes = await request("POST", "/api/auth/verify-email", {
      email: testEmail,
      otp: freshOtp,
    });
    if (validVerifyRes.status !== 200 || !validVerifyRes.json?.success) {
      throw new Error(`Expected 200 for valid OTP, got ${validVerifyRes.status}`);
    }
    if (validVerifyRes.json?.data?.user?.emailVerified !== true) {
      throw new Error("Returned user object does not have emailVerified = true");
    }

    const updatedUser = await User.findOne({ email: testEmail });
    if (!updatedUser || updatedUser.emailVerified !== true) {
      throw new Error("Database user emailVerified was not updated to true");
    }
    console.log("✔ TEST 3 PASSED: Account verified successfully with valid 6-digit OTP");

    // --- TEST 4: Resend verification for already-verified account informs user ---
    console.log("\n[TEST 4: Resend Verification for Already-Verified Account]");
    const resendAlreadyRes = await request("POST", "/api/auth/resend-verification", {
      email: testEmail,
    });
    if (resendAlreadyRes.status !== 200 || !resendAlreadyRes.json?.alreadyVerified) {
      throw new Error(`Expected alreadyVerified response, got ${JSON.stringify(resendAlreadyRes.json)}`);
    }
    console.log("✔ TEST 4 PASSED: Resend informs user that account is already verified");

    // --- TEST 5: Direct Link-Based Verification with Raw Token ---
    console.log("\n[TEST 5: Direct Link-Based Verification]");
    const linkEmail = `link_user_${Date.now()}@samratfashion.com`;
    await request("POST", "/api/auth/register", {
      name: "Link Customer",
      email: linkEmail,
      password: testPassword,
    });
    const rawLinkToken = lastSentToken;
    const linkVerifyRes = await request("POST", "/api/auth/verify-email", {
      token: rawLinkToken,
    });
    if (linkVerifyRes.status !== 200 || !linkVerifyRes.json?.success) {
      throw new Error(`Expected 200 for token verification, got ${linkVerifyRes.status}`);
    }
    const linkUser = await User.findOne({ email: linkEmail });
    if (!linkUser?.emailVerified) throw new Error("User was not marked verified via direct token");
    console.log("✔ TEST 5 PASSED: Direct link-based token verified account successfully");

    // --- TEST 6: Resend Verification for Unverified Account ---
    console.log("\n[TEST 6: Resend Verification for Unverified Account]");
    const unverifiedEmail = `unverified_${Date.now()}@samratfashion.com`;
    await request("POST", "/api/auth/register", {
      name: "Unverified Customer",
      email: unverifiedEmail,
      password: testPassword,
    });
    const firstOtp = lastSentOtp;

    const resendRes = await request("POST", "/api/auth/resend-verification", {
      email: unverifiedEmail,
    });
    if (resendRes.status !== 200) throw new Error(`Resend failed with status ${resendRes.status}`);

    const newOtp = lastSentOtp;
    if (newOtp === firstOtp) {
      throw new Error("Expected new distinct OTP after resend");
    }
    console.log("✔ TEST 6 PASSED: Resend issued fresh OTP successfully");

    // --- TEST 7: Password Reset Flow (M1 - Indexed SHA-256 Lookup) ---
    console.log("\n[TEST 7: Password Reset Flow (M1)]");
    const rawResetToken = "known_reset_token_test_1234567890abcdef";
    const tokenHash = sha256Hex(rawResetToken);
    const bcryptHash = await bcrypt.hash(rawResetToken, 10);
    await PasswordResetToken.create({
      userId: updatedUser._id,
      tokenHash,
      bcryptHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const newPassword = "NewSecretPassword456!";
    const resetRes = await request("POST", "/api/auth/reset-password", {
      token: rawResetToken,
      newPassword,
    });

    if (resetRes.status !== 200 || !resetRes.json?.success) {
      throw new Error(`Reset password failed: ${JSON.stringify(resetRes.json)}`);
    }

    // Verify user can login with new password
    const loginRes = await request("POST", "/api/auth/login", {
      email: testEmail,
      password: newPassword,
    });
    if (loginRes.status !== 200 || !loginRes.json?.data?.accessToken) {
      throw new Error(`Login with new password failed: ${JSON.stringify(loginRes.json)}`);
    }
    console.log("✔ TEST 7 PASSED: Password reset succeeded via indexed O(1) query and login works");

    // --- TEST 8: M4 Checkout Block for Unverified Accounts ---
    console.log("\n[TEST 8: M4 Unverified Account Transaction Gating]");
    // Registration token for unverified customer
    const unverifiedCustomerToken = (await request("POST", "/api/auth/register", {
      name: "Unverified Shopper",
      email: `unverified_shopper_${Date.now()}@samratfashion.com`,
      password: "ShopperPassword123!",
    })).json?.data?.accessToken;

    const dummyAddressId = new mongoose.Types.ObjectId().toString();
    const checkoutBlockedRes = await request(
      "POST",
      "/api/orders",
      { addressId: dummyAddressId },
      { Authorization: `Bearer ${unverifiedCustomerToken}` }
    );

    if (checkoutBlockedRes.status !== 403 || checkoutBlockedRes.json?.code !== "EMAIL_NOT_VERIFIED") {
      throw new Error(`Expected 403 EMAIL_NOT_VERIFIED for unverified checkout, got ${checkoutBlockedRes.status} ${JSON.stringify(checkoutBlockedRes.json)}`);
    }
    console.log("✔ TEST 8 PASSED: Unverified account rejected at checkout with 403 EMAIL_NOT_VERIFIED");

    console.log("\n=======================================================");
    console.log("🎉 ALL AUTH, VERIFICATION, LOCKOUT & GATE TESTS PASSED!");
    console.log("=======================================================\n");
  } finally {
    emailService.sendVerificationEmail = originalSendVerification;
    server.close();
    await mongoose.disconnect();
  }
}

runAuthVerificationTests().catch((err) => {
  console.error("❌ TEST RUNNER FAILED:", err);
  process.exit(1);
});
