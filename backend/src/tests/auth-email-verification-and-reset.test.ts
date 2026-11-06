import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import authRoutes from "../routes/authRoutes";
import { User } from "../models/User";
import { PasswordResetToken } from "../models/PasswordResetToken";
import { EmailVerificationToken } from "../models/EmailVerificationToken";
import { connectSafeTestDb } from "./testHelpers";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes);

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

async function runAuthVerificationTests() {
  console.log("=== STARTING AUTH & EMAIL VERIFICATION TEST SUITE ===");
  await connectSafeTestDb();

  process.env.ALLOW_EMAIL_MOCK = "true";
  process.env.FRONTEND_URL = "http://localhost:3000";

  const server = app.listen(5099);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const request = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://localhost:5099${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json: json as any };
  };

  try {
    const testEmail = `verify_user_${Date.now()}@samratfashion.com`;
    const testPassword = "Password123!";

    // --- TEST 1: Registration creates user with emailVerified = false and dispatches OTP ---
    console.log("\n[TEST 1: User Registration with Verification]");
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
    if (verificationDoc.otp.length !== 6) {
      throw new Error(`OTP length is ${verificationDoc.otp.length}, expected 6 digits`);
    }
    console.log("✔ TEST 1 PASSED: Registration created user and issued 6-digit OTP:", verificationDoc.otp);

    // --- TEST 2: Verify email with invalid OTP fails ---
    console.log("\n[TEST 2: Verify with Invalid OTP]");
    const invalidVerifyRes = await request("POST", "/api/auth/verify-email", {
      email: testEmail,
      otp: "000000",
    });
    if (invalidVerifyRes.status !== 400) {
      throw new Error(`Expected 400 for invalid OTP, got ${invalidVerifyRes.status}`);
    }
    console.log("✔ TEST 2 PASSED: Invalid OTP rejected cleanly with 400");

    // --- TEST 3: Verify email with valid OTP succeeds ---
    console.log("\n[TEST 3: Verify with Valid OTP]");
    const validVerifyRes = await request("POST", "/api/auth/verify-email", {
      email: testEmail,
      otp: verificationDoc.otp,
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
    console.log("✔ TEST 3 PASSED: Account verified successfully with 6-digit OTP");

    // --- TEST 4: Resend verification for already-verified account informs user ---
    console.log("\n[TEST 4: Resend Verification for Already-Verified Account]");
    const resendAlreadyRes = await request("POST", "/api/auth/resend-verification", {
      email: testEmail,
    });
    if (resendAlreadyRes.status !== 200 || !resendAlreadyRes.json?.alreadyVerified) {
      throw new Error(`Expected alreadyVerified response, got ${JSON.stringify(resendAlreadyRes.json)}`);
    }
    console.log("✔ TEST 4 PASSED: Resend informs user that account is already verified");

    // --- TEST 5: Direct Link-Based Verification ---
    console.log("\n[TEST 5: Direct Link-Based Verification]");
    const linkEmail = `link_user_${Date.now()}@samratfashion.com`;
    await request("POST", "/api/auth/register", {
      name: "Link Customer",
      email: linkEmail,
      password: testPassword,
    });
    const linkDoc = await EmailVerificationToken.findOne({ email: linkEmail, usedAt: { $exists: false } });
    if (!linkDoc) throw new Error("Link verification token missing");

    const linkVerifyRes = await request("POST", "/api/auth/verify-email", {
      token: linkDoc.token,
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
    const firstOtpDoc = await EmailVerificationToken.findOne({ email: unverifiedEmail });
    const firstOtp = firstOtpDoc?.otp;

    const resendRes = await request("POST", "/api/auth/resend-verification", {
      email: unverifiedEmail,
    });
    if (resendRes.status !== 200) throw new Error(`Resend failed with status ${resendRes.status}`);

    const newOtpDoc = await EmailVerificationToken.findOne({ email: unverifiedEmail });
    if (!newOtpDoc || newOtpDoc.otp === firstOtp) {
      throw new Error("Expected new distinct OTP after resend");
    }
    console.log("✔ TEST 6 PASSED: Resend issued fresh OTP:", newOtpDoc.otp);

    // --- TEST 7: Password Reset Flow (Forgot Password & Reset Password) ---
    console.log("\n[TEST 7: Password Reset Flow]");
    const forgotRes = await request("POST", "/api/auth/forgot-password", {
      email: testEmail,
    });
    if (forgotRes.status !== 200 || !forgotRes.json?.success) {
      throw new Error(`Forgot password failed: ${JSON.stringify(forgotRes.json)}`);
    }

    const resetTokenDoc = await PasswordResetToken.findOne({ userId: updatedUser._id, usedAt: { $exists: false } });
    if (!resetTokenDoc) throw new Error("PasswordResetToken not found in database");

    // Test reset password with raw token
    // In our implementation, reset token is compared against tokenHash using bcrypt
    // Let's create a known token to test reset
    const newResetToken = "known_reset_token_test_1234567890abcdef";
    const tokenHash = await bcrypt.hash(newResetToken, 10);
    await PasswordResetToken.create({
      userId: updatedUser._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const newPassword = "NewSecretPassword456!";
    const resetRes = await request("POST", "/api/auth/reset-password", {
      token: newResetToken,
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
    console.log("✔ TEST 7 PASSED: Password reset succeeded and user logged in with new password");

    console.log("\n=======================================================");
    console.log("🎉 ALL 7 AUTH, VERIFICATION & RESET TESTS PASSED!");
    console.log("=======================================================\n");
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runAuthVerificationTests().catch((err) => {
  console.error("❌ TEST RUNNER FAILED:", err);
  process.exit(1);
});
