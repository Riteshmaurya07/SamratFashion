import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { once } from "events";
import authRoutes from "../routes/authRoutes";
import { User } from "../models/User";
import { PasswordResetToken } from "../models/PasswordResetToken";
import { connectSafeTestDb } from "./testHelpers";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/auth", authRoutes);

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

async function runGoogleAuthTests() {
  console.log("=== STARTING GOOGLE OAUTH & ACCOUNT LINKING TEST SUITE ===");
  await connectSafeTestDb();

  process.env.ALLOW_AUTH_MOCK = "true";
  process.env.ALLOW_EMAIL_MOCK = "true";
  process.env.FRONTEND_URL = "http://localhost:3000";

  const server = app.listen(5096);
  await once(server, "listening");

  const request = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://localhost:5096${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as Record<string, any>;
    return { status: res.status, json };
  };

  try {
    const googleEmail = `google_user_${Date.now()}@gmail.com`;
    const googleSub = `google_sub_${Date.now()}`;

    // --- TEST 1: New User Google Sign-Up ---
    console.log("\n[TEST 1: New User Google Sign-Up]");
    const googleRes = await request("POST", "/api/auth/google", {
      mockUser: {
        email: googleEmail,
        name: "Google Customer",
        googleId: googleSub,
        avatar: "https://example.com/avatar.jpg",
      },
    });

    console.log("Google auth status:", googleRes.status, googleRes.json?.message);
    if (googleRes.status !== 200 || !googleRes.json?.success) {
      throw new Error(`Google signup failed: ${JSON.stringify(googleRes.json)}`);
    }

    const createdUser = await User.findOne({ email: googleEmail });
    if (!createdUser) throw new Error("User was not found in MongoDB");
    if (createdUser.googleId !== googleSub) throw new Error(`Expected googleId ${googleSub}, got ${createdUser.googleId}`);
    if (createdUser.emailVerified !== true) throw new Error("Expected Google user emailVerified to be true");
    if (createdUser.authProvider !== "google") throw new Error("Expected authProvider to be google");
    if (createdUser.avatar !== "https://example.com/avatar.jpg") throw new Error("Expected avatar to be saved");
    if (!googleRes.json?.data?.accessToken) throw new Error("Expected access token in response");

    console.log("✔ TEST 1 PASSED: New user signed up via Google with verified status in MongoDB");

    // --- TEST 2: Password Login Attempt for Google-only Account ---
    console.log("\n[TEST 2: Password Login Attempt on Google-only Account]");
    const failedPasswordLogin = await request("POST", "/api/auth/login", {
      email: googleEmail,
      password: "RandomPassword123!",
    });

    if (failedPasswordLogin.status !== 400 || failedPasswordLogin.json?.code !== "GOOGLE_AUTH_REQUIRED") {
      throw new Error(`Expected GOOGLE_AUTH_REQUIRED 400, got ${failedPasswordLogin.status}: ${JSON.stringify(failedPasswordLogin.json)}`);
    }
    console.log("✔ TEST 2 PASSED: Password login rejected with clear guidance to use Google");

    // --- TEST 3: Linking Google to an Existing Email/Password User ---
    console.log("\n[TEST 3: Account Linking (Email/Password user connects Google)]");
    const existingEmail = `existing_local_${Date.now()}@gmail.com`;
    const localPassword = "MyLocalPassword123!";

    // Create local user
    const regRes = await request("POST", "/api/auth/register", {
      name: "Existing Local User",
      email: existingEmail,
      password: localPassword,
    });
    if (regRes.status !== 201) throw new Error(`Registration failed: ${regRes.status}`);

    const existingGoogleSub = `google_link_${Date.now()}`;
    // User clicks "Continue with Google" with same email
    const linkRes = await request("POST", "/api/auth/google", {
      mockUser: {
        email: existingEmail,
        name: "Existing Local User Google",
        googleId: existingGoogleSub,
      },
    });

    if (linkRes.status !== 200 || !linkRes.json?.success) {
      throw new Error(`Google linking failed: ${JSON.stringify(linkRes.json)}`);
    }

    const linkedUser = await User.findOne({ email: existingEmail });
    if (!linkedUser) throw new Error("Linked user not found");
    if (linkedUser.googleId !== existingGoogleSub) throw new Error("googleId was not linked to existing user");
    if (linkedUser.emailVerified !== true) throw new Error("Existing user was not marked emailVerified after Google login");
    if (!linkedUser.passwordHash) throw new Error("Original passwordHash was wiped during Google link!");

    // Verify user can STILL log in via original email & password
    const loginWithPassword = await request("POST", "/api/auth/login", {
      email: existingEmail,
      password: localPassword,
    });
    if (loginWithPassword.status !== 200 || !loginWithPassword.json?.data?.accessToken) {
      throw new Error(`Password login after Google link failed: ${JSON.stringify(loginWithPassword.json)}`);
    }

    // Verify user can ALSO log in via Google
    const loginWithGoogleAgain = await request("POST", "/api/auth/google", {
      mockUser: {
        email: existingEmail,
        name: "Existing Local User Google",
        googleId: existingGoogleSub,
      },
    });
    if (loginWithGoogleAgain.status !== 200 || !loginWithGoogleAgain.json?.data?.accessToken) {
      throw new Error(`Google login after link failed: ${JSON.stringify(loginWithGoogleAgain.json)}`);
    }

    console.log("✔ TEST 3 PASSED: Account linked seamlessly — user can log in with EITHER email+password OR Google!");

    // --- TEST 4: Google User Sets Password via Password Reset ---
    console.log("\n[TEST 4: Google-created user sets password via reset to enable email login]");
    const resetToken = "google_reset_token_test_abc123";
    const tokenHash = await bcrypt.hash(resetToken, 10);
    await PasswordResetToken.create({
      userId: createdUser._id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const newSetPassword = "BrandNewPassword123!";
    const resetRes = await request("POST", "/api/auth/reset-password", {
      token: resetToken,
      newPassword: newSetPassword,
    });
    if (resetRes.status !== 200) throw new Error(`Password set failed: ${resetRes.status}`);

    const loginAfterSet = await request("POST", "/api/auth/login", {
      email: googleEmail,
      password: newSetPassword,
    });
    if (loginAfterSet.status !== 200 || !loginAfterSet.json?.data?.accessToken) {
      throw new Error(`Login after setting password failed: ${JSON.stringify(loginAfterSet.json)}`);
    }
    console.log("✔ TEST 4 PASSED: Google-created user successfully set password and can now log in with either method");

    console.log("\n=======================================================");
    console.log("🎉 ALL 4 GOOGLE OAUTH & DUAL-LOGIN TESTS PASSED!");
    console.log("=======================================================\n");
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runGoogleAuthTests().catch((err) => {
  console.error("❌ TEST RUNNER FAILED:", err);
  process.exit(1);
});
