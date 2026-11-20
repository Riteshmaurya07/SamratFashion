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
  checkPwnedPassword,
} from "../utils/validation";
import { OAuth2Client } from "google-auth-library";
import { isStrictProductionOrStaging } from "../config/env";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

const isProd = isStrictProductionOrStaging();

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

// Precomputed bcrypt hash used to equalize login timing for unknown emails so an
// attacker cannot enumerate registered accounts by response latency.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

export const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

// N-M1: Peppered HMAC-SHA256 for 6-digit OTPs so DB leaks cannot be offline-brute-forced
export const hashOtp = (otp: string): string =>
  crypto.createHmac("sha256", getJwtAccessSecret()).update(otp).digest("hex");

const generateTokens = (userId: string, role: string, tokenVersion = 0) => {
  const accessToken = jwt.sign(
    { sub: userId, role, tokenVersion },
    getJwtAccessSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
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

    // N-M7: Check against breached passwords
    if (await checkPwnedPassword(validatedData.password)) {
      return next(
        new AppError(
          "This password has appeared in a known data breach. Please choose a more secure password.",
          400,
          "COMPROMISED_PASSWORD"
        )
      );
    }

    const existingUser = await User.findOne({ 
      $or: [
        { email: normalizedEmail },
        ...(validatedData.phone ? [{ phone: validatedData.phone }] : [])
      ]
    });

    if (existingUser) {
      // N-M3: Prevent user enumeration by returning generic success
      return res.status(201).json({
        success: true,
        message: "Registration successful. Please verify your email with the code sent to your inbox.",
        data: {
          requiresVerification: true,
        },
      });
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
      failedLoginAttempts: 0,
      tokenVersion: 0,
    });

    // Generate 6-digit OTP and direct token for email verification
    const otp = crypto.randomInt(100000, 1000000).toString();
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // N-M1: Store HMAC-SHA256(otp) and sha256(token) at rest with failed-attempts counter
    await EmailVerificationToken.create({
      userId: newUser._id,
      email: normalizedEmail,
      otp: hashOtp(otp),
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

    // N-M9 & N-H2: Do not issue cookies or return accessToken before email verification
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

    // N-H3: Check persistent account lockout before attempting password comparison
    if (user && user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return next(
        new AppError(
          "Account is temporarily locked due to multiple failed login attempts. Please try again later.",
          423,
          "ACCOUNT_LOCKED"
        )
      );
    }

    // Equalize execution time between existing and non-existing accounts:
    // always perform a real bcrypt compare against a precomputed cost-12 hash
    // so an external observer cannot enumerate valid accounts via response timing.
    const hashToCompare = user?.passwordHash || DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(validatedData.password, hashToCompare);

    if (!user || !user.passwordHash || !isPasswordValid) {
      if (user) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= 5) {
          const lockDurationMs = user.failedLoginAttempts >= 10 ? 60 * 60 * 1000 : 30 * 60 * 1000;
          user.lockedUntil = new Date(Date.now() + lockDurationMs);
        }
        await user.save();
      }
      return next(new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS"));
    }

    // N-M3: Uniform response for non-active statuses to prevent account enumeration
    if (user.status !== UserStatus.ACTIVE) {
      return next(new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS"));
    }

    // Reset lockout counters on successful credentials
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    // N-L10: Revoke other existing sessions upon login to prevent session fixation / concurrency leaks
    await Session.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } }
    );

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role, user.tokenVersion || 0);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(user._id, refreshToken, familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions);

    // N-H2: Do not return accessToken in body — rely solely on httpOnly cookies
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
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * N-M8: /24 subnet comparison for refresh token IP binding.
 *
 * Rule:
 * - IPv4: Compares the first 3 octets (/24 prefix, e.g. 203.0.113.x vs 203.0.113.y).
 *   Legitimate mobile-network IP changes (e.g. carrier NAT reallocations or cell tower handoffs
 *   within the same /24 pool) will succeed. Cross-network token theft (different /24 or network)
 *   revokes the entire session family and forces re-login.
 * - IPv6: Compares the first 3 segments (/48 prefix) to accommodate standard dynamic end-user allocations.
 * - IPv4-mapped IPv6 (::ffff:a.b.c.d) is normalized to standard IPv4.
 * - IPv4 vs IPv6 family mismatch is treated as a gross network mismatch (returns false).
 * - If either stored or incoming IP is empty, returns true (does not penalize missing network headers).
 */
export function isSameSubnet(storedIp: string, incomingIp: string): boolean {
  if (!storedIp || !incomingIp) return true;

  const cleanStored = storedIp.replace(/^::ffff:/i, "").trim();
  const cleanIncoming = incomingIp.replace(/^::ffff:/i, "").trim();

  if (cleanStored === cleanIncoming) return true;

  const isStoredV4 = cleanStored.includes(".");
  const isIncomingV4 = cleanIncoming.includes(".");

  if (isStoredV4 !== isIncomingV4) {
    return false;
  }

  if (isStoredV4) {
    const p1 = cleanStored.split(".");
    const p2 = cleanIncoming.split(".");
    if (p1.length === 4 && p2.length === 4) {
      return p1[0] === p2[0] && p1[1] === p2[1] && p1[2] === p2[2];
    }
    return cleanStored === cleanIncoming;
  }

  const b1 = cleanStored.split(":");
  const b2 = cleanIncoming.split(":");
  if (b1.length >= 3 && b2.length >= 3) {
    return b1[0] === b2[0] && b1[1] === b2[1] && b1[2] === b2[2];
  }

  return cleanStored === cleanIncoming;
}

const findSessionByToken = async (refreshToken: string): Promise<any | null> => {
  const tokenHash = sha256Hex(refreshToken);
  const session = await Session.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  // N-L7: Verify stored bcrypt hash alongside sha256 lookup
  if (session.refreshTokenHash) {
    const isMatch = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!isMatch) return null;
  }
  return session;
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

    // N-H1: Immediate reuse attack detection.
    // If an already-revoked token is presented, revoke the entire family immediately and issue nothing.
    if (session.revokedAt) {
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

    // N-M8: User-Agent binding check
    const incomingUa = req.headers["user-agent"] || "";
    const storedUa = session.userAgent || "";
    if (storedUa && incomingUa) {
      const isStoredMobile = /mobile|android|iphone|ipad/i.test(storedUa);
      const isIncomingMobile = /mobile|android|iphone|ipad/i.test(incomingUa);
      if (isStoredMobile !== isIncomingMobile) {
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
    }

    // N-M8: IP binding check (/24 comparison)
    // Compares incoming request IP with stored session IP. On a gross mismatch,
    // revokes the entire token family and forces re-login.
    const incomingIp = (req.ip || (req.socket?.remoteAddress as string) || "").trim();
    const storedIp = (session.ip || "").trim();
    if (storedIp && incomingIp) {
      if (!isSameSubnet(storedIp, incomingIp)) {
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
    }

    const user = await User.findById(session.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      res.clearCookie("accessToken", clearCookieOptions);
      res.clearCookie("refreshToken", clearCookieOptions);
      return next(new AppError("User account issue", 401, "UNAUTHORIZED"));
    }

    // Rotate: revoke the presented token and issue a sibling within the same family.
    session.revokedAt = new Date();
    session.lastUsedAt = new Date();
    await session.save();

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id.toString(), user.role, user.tokenVersion || 0);
    await createRefreshSession(user._id, newRefreshToken, session.familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", newRefreshToken, refreshTokenCookieOptions);

    // N-H2: Do not return accessToken in body
    res.status(200).json({
      success: true,
      data: { refreshed: true },
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
      // N-L1: Dummy work to prevent timing side-channel
      await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
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

    // N-M7: Check breached password
    if (await checkPwnedPassword(validatedData.newPassword)) {
      return next(
        new AppError(
          "This password has appeared in a known data breach. Please choose a more secure password.",
          400,
          "COMPROMISED_PASSWORD"
        )
      );
    }

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

    // N-L2: Atomic consumption of reset token to prevent concurrent replay race
    const consumedToken = await PasswordResetToken.findOneAndUpdate(
      { _id: validTokenDoc._id, usedAt: { $exists: false } },
      { $set: { usedAt: new Date() } }
    );
    if (!consumedToken) {
      return next(new AppError("Reset token has already been used", 400, "TOKEN_ALREADY_USED"));
    }

    const salt = await bcrypt.genSalt(12);
    user.passwordHash = await bcrypt.hash(validatedData.newPassword, salt);
    // N-M10: Increment tokenVersion to immediately revoke all existing access tokens
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

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

      // N-M1: Peppered HMAC-SHA256 comparison with constant-time equality check
      const inputOtpHash = hashOtp(validatedData.otp.trim());
      const isOtpMatch =
        tokenDoc.otp.length === inputOtpHash.length &&
        crypto.timingSafeEqual(Buffer.from(tokenDoc.otp), Buffer.from(inputOtpHash));

      if (!isOtpMatch) {
        // N-M2: Atomic failure increment
        const updatedToken = await EmailVerificationToken.findOneAndUpdate(
          { _id: tokenDoc._id },
          { $inc: { failedAttempts: 1 } },
          { returnDocument: 'after' }
        );

        if ((updatedToken?.failedAttempts || 0) >= 5) {
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

    // N-L2: Atomic consumption to prevent race condition on usedAt
    const consumedToken = await EmailVerificationToken.findOneAndUpdate(
      { _id: tokenDoc._id, usedAt: { $exists: false } },
      { $set: { usedAt: new Date() } }
    );
    if (!consumedToken) {
      return next(
        new AppError(
          "Verification code has already been used. Please request a new one.",
          400,
          "TOKEN_ALREADY_USED"
        )
      );
    }

    user.emailVerified = true;
    await user.save();

    // Clean up any remaining verification tokens for this user
    await EmailVerificationToken.deleteMany({
      userId: user._id,
      _id: { $ne: tokenDoc._id },
    });

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role, user.tokenVersion || 0);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(user._id, refreshToken, familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions);

    // N-H2: Do not return accessToken in body — httpOnly cookies only
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

    // N-M3 & N-L1: Prevent user enumeration and timing leak for already verified or non-existent accounts
    if (!user || user.status !== UserStatus.ACTIVE || user.emailVerified) {
      await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
      return res.status(200).json({ success: true, message: genericMessage });
    }

    // Invalidate previous tokens
    await EmailVerificationToken.deleteMany({ email: normalizedEmail });

    const otp = crypto.randomInt(100000, 1000000).toString();
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    // N-M1: Store HMAC-SHA256(otp) and sha256(token) at rest with failed-attempts counter
    await EmailVerificationToken.create({
      userId: user._id,
      email: normalizedEmail,
      otp: hashOtp(otp),
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
      message: genericMessage,
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
            503,
            "GOOGLE_AUTH_UNCONFIGURED"
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
        // N-M6: Require email_verified to be explicitly true from Google payload
        if (payload.email_verified !== true) {
          return next(new AppError("Google account email is not verified by Google", 401, "GOOGLE_EMAIL_UNVERIFIED"));
        }
        googleProfile = {
          sub: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          email_verified: Boolean(payload.email_verified),
        };
      } catch (err: any) {
        if (err instanceof AppError) return next(err);
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

      // N-M3: Uniform response for non-active statuses
      if (user.status !== UserStatus.ACTIVE) {
        return next(new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS"));
      }

      // Link googleId if not yet linked
      if (!user.googleId) {
        // N-M6: Prohibit automatic linking for administrative roles without password verification
        if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
          return next(
            new AppError(
              "Automatic Google linking is disabled for administrative accounts. Please sign in with email and password.",
              403,
              "ADMIN_LINK_FORBIDDEN"
            )
          );
        }
        // N-M6: Require local email to be verified before account linking
        if (!user.emailVerified) {
          return next(
            new AppError(
              "Cannot link Google account to an unverified email address. Please verify your email first.",
              403,
              "EMAIL_NOT_VERIFIED"
            )
          );
        }
        user.googleId = googleProfile.sub;
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
        failedLoginAttempts: 0,
        tokenVersion: 0,
      });
    }

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role, user.tokenVersion || 0);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(user._id, refreshToken, familyId, req);

    res.cookie("accessToken", accessToken, accessTokenCookieOptions);
    res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions);

    // N-H2: Do not return accessToken in body — httpOnly cookies only
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
      },
    });
  } catch (error) {
    next(error);
  }
};
