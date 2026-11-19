import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import mongoose from "mongoose";
import { User, UserRole, UserStatus } from "../models/User";
import { Session } from "../models/Session";
import { EmailVerificationToken } from "../models/EmailVerificationToken";
import { PasswordResetToken } from "../models/PasswordResetToken";
import { emailService } from "../services/emailService";
import { AppError } from "../utils/AppError";
import { getJwtAccessSecret } from "../config/env";
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  googleAuthSchema,
} from "../utils/validation";
import { OAuth2Client } from "google-auth-library";
import { isStrictProductionOrStaging } from "../config/env";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

const isProd = process.env.NODE_ENV === "production";

/**
 * Mock authentication is a development-only convenience. It requires BOTH a
 * non-production environment and an explicit opt-in flag; ALLOW_EMAIL_MOCK can
 * never enable it. Production startup rejects either flag (config/env.ts).
 */
const isMockAuthAllowed = (): boolean =>
  !isStrictProductionOrStaging() && process.env.ALLOW_AUTH_MOCK === "true";

/**
 * Local password-reset links may be echoed back only in development/test with
 * an explicit email-mock opt-in. They are never returned in production.
 */
const isMockEmailAllowed = (): boolean =>
  !isStrictProductionOrStaging() && process.env.ALLOW_EMAIL_MOCK === "true";

export const accessTokenCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: 15 * 60 * 1000, // 15 minutes
};

export const refreshTokenCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
};

export const clearCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? "none" : "lax") as "none" | "lax",
  path: "/",
};



// A reused-but-recently-rotated token within this window is treated as a benign
// multi-tab race instead of a credential leak. Aligned with the access token
// lifetime so a sleeping tab that comes back within its own expiry still works.
const REUSE_GRACE_MS = 15 * 60 * 1000;

// Precomputed bcrypt hash used to equalize login timing for unknown emails so an
// attacker cannot enumerate registered accounts by response latency.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

export const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const generateTokens = (userId: string, role: string) => {
  const accessToken = jwt.sign({ sub: userId, role }, getJwtAccessSecret(), { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
  const refreshToken = crypto.randomBytes(40).toString("hex");
  return { accessToken, refreshToken };
};

const createRefreshSession = async (
  userId: mongoose.Types.ObjectId | string,
  refreshToken: string,
  familyId: string | undefined,
  req: Request
) => {
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);

  return Session.create({
    userId: userId as mongoose.Types.ObjectId,
    refreshTokenHash,
    tokenHash: sha256Hex(refreshToken),
    familyId,
    expiresAt,
    lastUsedAt: new Date(),
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = registerSchema.parse(req.body);
    const normalizedEmail = validatedData.email.trim().toLowerCase();

    const existingUser = await User.findOne({ 
      $or: [
        { email: normalizedEmail },
        ...(validatedData.phone ? [{ phone: validatedData.phone }] : [])
      ]
    });

    if (existingUser) {
      if (existingUser.email === normalizedEmail) {
        return next(new AppError("Email is already registered", 409, "DUPLICATE_EMAIL"));
      }
      return next(new AppError("Phone number is already registered", 409, "DUPLICATE_PHONE"));
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(validatedData.password, salt);

    const newUser = await User.create({
      name: validatedData.name,
      email: normalizedEmail,
      phone: validatedData.phone,
      passwordHash,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: false,
    });

    // Generate 6-digit OTP and direct token for email verification
    const otp = crypto.randomInt(100000, 1000000).toString();
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // H1: Store sha256(otp) and sha256(token) at rest with failed-attempts counter
    await EmailVerificationToken.create({
      userId: newUser._id,
      email: normalizedEmail,
      otp: sha256Hex(otp),
      token: sha256Hex(verificationToken),
      failedAttempts: 0,
      expiresAt: verificationExpiresAt,
    });

    await emailService.sendVerificationEmail(
      normalizedEmail,
      otp,
      verificationToken,
      newUser._id.toString(),
      newUser.name
    );

    const { accessToken, refreshToken } = generateTokens(newUser._id.toString(), newUser.role);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(newUser._id, refreshToken, familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions);

    res.status(201).json({
      success: true,
      message: "Registration successful. Please verify your email with the code sent to your inbox.",
      data: {
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          emailVerified: false,
        },
        accessToken,
        requiresVerification: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = loginSchema.parse(req.body);
    const normalizedEmail = validatedData.email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });

    // Equalize execution time between existing and non-existing accounts:
    // always perform a real bcrypt compare against a precomputed cost-12 hash
    // so an external observer cannot enumerate valid accounts via response timing.
    const hashToCompare = user?.passwordHash || DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(validatedData.password, hashToCompare);

    if (!user || !user.passwordHash || !isPasswordValid) {
      return next(new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS"));
    }

    if (user.status === UserStatus.SUSPENDED) {
      return next(
        new AppError(
          "Your account has been temporarily suspended. Please contact customer support.",
          403,
          "ACCOUNT_SUSPENDED"
        )
      );
    }
    if (user.status === UserStatus.DISABLED) {
      return next(
        new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS")
      );
    }

    user.lastLoginAt = new Date();
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(user._id, refreshToken, familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions);

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
        },
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

const findSessionByToken = async (refreshToken: string): Promise<any | null> => {
  const tokenHash = sha256Hex(refreshToken);
  return Session.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  });
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }

    const session = await findSessionByToken(refreshToken);

    if (!session) {
      res.clearCookie("accessToken", clearCookieOptions);
      res.clearCookie("refreshToken", clearCookieOptions);
      return next(new AppError("Session expired or invalid", 401, "SESSION_EXPIRED"));
    }

    // Reuse-attack detection: an expired token presented outside the multi-tab
    // grace window means the token escaped to another party -> kill the family.
    if (session.revokedAt && Date.now() - new Date(session.revokedAt).getTime() > REUSE_GRACE_MS) {
      if (session.familyId) {
        await Session.updateMany(
          { familyId: session.familyId, revokedAt: { $exists: false } },
          { $set: { revokedAt: new Date() } }
        );
      }
      res.clearCookie("accessToken", clearCookieOptions);
      res.clearCookie("refreshToken", clearCookieOptions);
      return next(new AppError("Session expired or invalid", 401, "SESSION_EXPIRED"));
    }

    const user = await User.findById(session.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      res.clearCookie("accessToken", clearCookieOptions);
      res.clearCookie("refreshToken", clearCookieOptions);
      return next(new AppError("User account issue", 401, "UNAUTHORIZED"));
    }

    // Rotate: revoke the presented token and issue a sibling within the same family.
    // Multi-tab peers (already-revoked tokens within the grace window) also get a
    // fresh sibling instead of being force-logged-out.
    if (!session.revokedAt) {
      session.revokedAt = new Date();
      await session.save();
    }
    session.lastUsedAt = new Date();
    await session.save();

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id.toString(), user.role);
    await createRefreshSession(user._id, newRefreshToken, session.familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", newRefreshToken, refreshTokenCookieOptions);

    res.status(200).json({
      success: true,
      data: { accessToken },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.cookies;
    if (refreshToken) {
      const session = await findSessionByToken(refreshToken);
      if (session && !session.revokedAt) {
        session.revokedAt = new Date();
        await session.save();
      }
    }

    res.clearCookie("accessToken", clearCookieOptions);
    res.clearCookie("refreshToken", clearCookieOptions);
    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }

    const user = await User.findById(userId).select("-passwordHash");
    if (!user) {
      return next(new AppError("User not found", 404, "NOT_FOUND"));
    }

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          avatar: user.avatar,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
        }
      },
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = forgotPasswordSchema.parse(req.body);
    const user = await User.findOne({ email: validatedData.email.trim().toLowerCase() });

    const genericMessage = "If an account exists for this email, password reset instructions will be sent.";

    if (!user || user.status !== UserStatus.ACTIVE) {
      return res.status(200).json({ success: true, message: genericMessage });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(resetToken);
    const bcryptHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any previous unexpired reset tokens for this user
    await PasswordResetToken.deleteMany({ userId: user._id });

    // M1: Store sha256(token) alongside bcrypt hash for indexed O(1) query
    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      bcryptHash,
      expiresAt,
    });
    await emailService.sendPasswordResetEmail(user.email, resetToken, user._id.toString());

    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password?token=${resetToken}`;

    res.status(200).json({
      success: true,
      message: genericMessage,
      // Never disclose reset material in production, regardless of any flag.
      ...(isMockEmailAllowed() ? { data: { resetUrl, resetToken } } : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = resetPasswordSchema.parse(req.body);
    const inputToken = validatedData.token.trim();
    const tokenHash = sha256Hex(inputToken);

    // M1: Indexed O(1) query instead of scanning all unexpired tokens with bcrypt in a loop
    const validTokenDoc = await PasswordResetToken.findOne({ 
      tokenHash,
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() }
    });

    if (!validTokenDoc) {
      return next(new AppError("Invalid or expired reset token", 400, "INVALID_TOKEN"));
    }

    if (validTokenDoc.bcryptHash) {
      const isMatch = await bcrypt.compare(inputToken, validTokenDoc.bcryptHash);
      if (!isMatch) {
        return next(new AppError("Invalid or expired reset token", 400, "INVALID_TOKEN"));
      }
    }

    const user = await User.findById(validTokenDoc.userId);
    if (!user) {
      return next(new AppError("Invalid or expired reset token", 400, "INVALID_TOKEN"));
    }

    const salt = await bcrypt.genSalt(12);
    user.passwordHash = await bcrypt.hash(validatedData.newPassword, salt);
    await user.save();

    validTokenDoc.usedAt = new Date();
    await validTokenDoc.save();

    // Revoke all existing sessions for security
    await Session.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    );

    res.status(200).json({ success: true, message: "Password reset successful. Please login again." });
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = verifyEmailSchema.parse(req.body);

    let tokenDoc: any = null;

    if (validatedData.token) {
      const hashedToken = sha256Hex(validatedData.token.trim());
      tokenDoc = await EmailVerificationToken.findOne({
        token: hashedToken,
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      });

      if (!tokenDoc) {
        return next(
          new AppError(
            "Invalid or expired verification code. Please request a new one.",
            400,
            "INVALID_VERIFICATION_CODE"
          )
        );
      }

      if ((tokenDoc.failedAttempts || 0) >= 5) {
        return next(
          new AppError(
            "Verification code locked due to too many failed attempts. Please request a new one.",
            400,
            "VERIFICATION_LOCKED"
          )
        );
      }
    } else if (validatedData.email && validatedData.otp) {
      const normalizedEmail = validatedData.email.trim().toLowerCase();
      tokenDoc = await EmailVerificationToken.findOne({
        email: normalizedEmail,
        usedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 });

      if (!tokenDoc) {
        return next(
          new AppError(
            "Invalid or expired verification code. Please request a new one.",
            400,
            "INVALID_VERIFICATION_CODE"
          )
        );
      }

      if ((tokenDoc.failedAttempts || 0) >= 5) {
        return next(
          new AppError(
            "Verification code locked due to too many failed attempts. Please request a new one.",
            400,
            "VERIFICATION_LOCKED"
          )
        );
      }

      const inputOtpHash = sha256Hex(validatedData.otp.trim());
      if (tokenDoc.otp !== inputOtpHash) {
        tokenDoc.failedAttempts = (tokenDoc.failedAttempts || 0) + 1;
        await tokenDoc.save();

        if (tokenDoc.failedAttempts >= 5) {
          return next(
            new AppError(
              "Verification code locked due to too many failed attempts. Please request a new one.",
              400,
              "VERIFICATION_LOCKED"
            )
          );
        }

        return next(
          new AppError(
            "Invalid or expired verification code. Please request a new one.",
            400,
            "INVALID_VERIFICATION_CODE"
          )
        );
      }
    } else {
      return next(
        new AppError(
          "Invalid or expired verification code. Please request a new one.",
          400,
          "INVALID_VERIFICATION_CODE"
        )
      );
    }

    const user = await User.findById(tokenDoc.userId);
    if (!user) {
      return next(new AppError("User account not found", 404, "USER_NOT_FOUND"));
    }

    user.emailVerified = true;
    await user.save();

    tokenDoc.usedAt = new Date();
    await tokenDoc.save();

    // Clean up any remaining verification tokens for this user
    await EmailVerificationToken.deleteMany({
      userId: user._id,
      _id: { $ne: tokenDoc._id },
    });

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(user._id, refreshToken, familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions);

    res.status(200).json({
      success: true,
      message: "Email verified successfully!",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          emailVerified: true,
        },
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const resendVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = resendVerificationSchema.parse(req.body);
    const normalizedEmail = validatedData.email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    const genericMessage =
      "If an unverified account exists for this email, a verification code has been sent.";

    if (!user || user.status !== UserStatus.ACTIVE) {
      return res.status(200).json({ success: true, message: genericMessage });
    }

    if (user.emailVerified) {
      return res.status(200).json({
        success: true,
        message: "Email is already verified. You can log in.",
        alreadyVerified: true,
      });
    }

    // Invalidate previous tokens
    await EmailVerificationToken.deleteMany({ email: normalizedEmail });

    const otp = crypto.randomInt(100000, 1000000).toString();
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // H1: Store sha256(otp) and sha256(token) at rest with failed-attempts counter
    await EmailVerificationToken.create({
      userId: user._id,
      email: normalizedEmail,
      otp: sha256Hex(otp),
      token: sha256Hex(verificationToken),
      failedAttempts: 0,
      expiresAt: verificationExpiresAt,
    });

    await emailService.sendVerificationEmail(
      normalizedEmail,
      otp,
      verificationToken,
      user._id.toString(),
      user.name
    );

    res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email.",
    });
  } catch (error) {
    next(error);
  }
};

export const googleAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = googleAuthSchema.parse(req.body);

    let googleProfile: {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
      email_verified?: boolean;
    } | null = null;

    // 1. Google ID Token (credential): the signature is ALWAYS verified by
    // Google. Unsigned JWT payloads must never be decoded and trusted.
    if (validatedData.credential) {
      if (!process.env.GOOGLE_CLIENT_ID) {
        return next(
          new AppError(
            "Google sign-in is not configured on the backend server",
            500,
            "CONFIGURATION_ERROR"
          )
        );
      }

      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: validatedData.credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
          return next(new AppError("Failed to extract Google account email", 400, "INVALID_GOOGLE_CREDENTIAL"));
        }
        googleProfile = {
          sub: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          email_verified: true,
        };
      } catch {
        // No development fallback: an unverified token is always rejected.
        return next(new AppError("Invalid Google credential", 401, "INVALID_GOOGLE_CREDENTIAL"));
      }
    } else if (validatedData.mockUser) {
      if (!isMockAuthAllowed()) {
        return next(new AppError("Mock authentication is not permitted in production", 403, "FORBIDDEN"));
      }
      googleProfile = {
        sub: validatedData.mockUser.googleId || `google_mock_${Date.now()}`,
        email: validatedData.mockUser.email,
        name: validatedData.mockUser.name,
        picture: validatedData.mockUser.avatar,
        email_verified: true,
      };
    }

    if (!googleProfile || !googleProfile.email) {
      return next(new AppError("Failed to retrieve Google profile", 400, "GOOGLE_PROFILE_ERROR"));
    }

    const normalizedEmail = googleProfile.email.trim().toLowerCase();

    // Find existing user by googleId or by email (linking accounts!)
    let user = await User.findOne({
      $or: [{ googleId: googleProfile.sub }, { email: normalizedEmail }],
    });

    if (user) {
      // Mock auth cannot compromise administrative accounts
      if (validatedData.mockUser && (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN)) {
        return next(new AppError("Mock authentication cannot access administrative roles", 403, "FORBIDDEN"));
      }

      if (user.status === UserStatus.SUSPENDED) {
        return next(
          new AppError("Your account is currently unavailable. Please contact support.", 403, "ACCOUNT_SUSPENDED")
        );
      }
      if (user.status === UserStatus.DISABLED) {
        return next(new AppError("Account has been disabled. Please contact support.", 401, "AUTH_FAILED"));
      }

      // Link googleId if not yet linked
      if (!user.googleId) {
        user.googleId = googleProfile.sub;
      }
      // Google pre-verifies email addresses
      if (!user.emailVerified) {
        user.emailVerified = true;
      }
      user.lastLoginAt = new Date();
      await user.save();
    } else {
      // Create fresh customer account with pre-verified email from Google
      user = await User.create({
        name: googleProfile.name || normalizedEmail.split("@")[0],
        email: normalizedEmail,
        googleId: googleProfile.sub,
        authProvider: "google",
        avatar: googleProfile.picture,
        emailVerified: true, // Google pre-verifies email
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        lastLoginAt: new Date(),
      });
    }

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(user._id, refreshToken, familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions);

    res.status(200).json({
      success: true,
      message: "Successfully signed in with Google",
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          emailVerified: user.emailVerified,
          authProvider: user.authProvider || "google",
        },
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};
