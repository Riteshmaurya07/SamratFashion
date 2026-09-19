import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";
import { User, UserStatus } from "../models/User";
import { Session } from "../models/Session";
import { PasswordResetToken } from "../models/PasswordResetToken";
import { emailService } from "../services/emailService";
import { AppError } from "../utils/AppError";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "../utils/validation";
import { getJwtAccessSecret, getJwtRefreshSecret } from "../config/env";

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
};

// A reused-but-recently-rotated token within this window is treated as a benign
// multi-tab race instead of a credential leak. Aligned with the access token
// lifetime so a sleeping tab that comes back within its own expiry still works.
const REUSE_GRACE_MS = 15 * 60 * 1000;

// Precomputed bcrypt hash used to equalize login timing for unknown emails so an
// attacker cannot enumerate registered accounts by response latency.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

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
  const expiresAt = new Date(Date.now() + cookieOptions.maxAge);
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
    });

    const { accessToken, refreshToken } = generateTokens(newUser._id.toString(), newUser.role);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(newUser._id, refreshToken, familyId, req);

    res.cookie("refreshToken", refreshToken, cookieOptions);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        },
        accessToken,
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

    // Unknown email: burn the same amount of bcrypt work so latency cannot
    // distinguish registered from unregistered accounts.
    if (!user) {
      await bcrypt.compare(validatedData.password, DUMMY_PASSWORD_HASH);
      return next(new AppError("Email or password is incorrect", 401, "AUTH_FAILED"));
    }

    // Always verify the password first (even for suspended/disabled accounts) to
    // keep timing uniform across all branches.
    const isMatch = await bcrypt.compare(validatedData.password, user.passwordHash);
    if (!isMatch) {
      return next(new AppError("Email or password is incorrect", 401, "AUTH_FAILED"));
    }

    if (user.status === UserStatus.SUSPENDED) {
      return next(new AppError("Your account is currently unavailable. Please contact support.", 403, "ACCOUNT_SUSPENDED"));
    }
    if (user.status === UserStatus.DISABLED) {
      return next(new AppError("Email or password is incorrect", 401, "AUTH_FAILED"));
    }

    user.lastLoginAt = new Date();
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role);
    const familyId = crypto.randomBytes(16).toString("hex");
    await createRefreshSession(user._id, refreshToken, familyId, req);

    res.cookie("refreshToken", refreshToken, cookieOptions);

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
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
  const session = await Session.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  });
  if (session) return session;

  // Migration fallback: pre tokenHash sessions can only be matched by a bounded
  // bcrypt sweep (legacy rows) instead of scanning the whole collection.
  const legacyCandidates = await Session.find({
    tokenHash: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  for (const candidate of legacyCandidates) {
    if (await bcrypt.compare(refreshToken, candidate.refreshTokenHash)) {
      return candidate;
    }
  }
  return null;
};

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }

    const session = await findSessionByToken(refreshToken);

    if (!session) {
      res.clearCookie("refreshToken");
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
      res.clearCookie("refreshToken");
      return next(new AppError("Session expired or invalid", 401, "SESSION_EXPIRED"));
    }

    const user = await User.findById(session.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      res.clearCookie("refreshToken");
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

    res.cookie("refreshToken", newRefreshToken, cookieOptions);

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

    res.clearCookie("refreshToken");
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
          phone: user.phone,
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
    const tokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await PasswordResetToken.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    await emailService.sendPasswordResetEmail(user.email, resetToken, user._id.toString());

    res.status(200).json({ success: true, message: genericMessage });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = resetPasswordSchema.parse(req.body);
    
    // Find non-used tokens that haven't expired
    const tokens = await PasswordResetToken.find({ 
      usedAt: { $exists: false },
      expiresAt: { $gt: new Date() }
    });

    let validTokenDoc = null;
    for (const doc of tokens) {
      const isMatch = await bcrypt.compare(validatedData.token, doc.tokenHash);
      if (isMatch) {
        validTokenDoc = doc;
        break;
      }
    }

    if (!validTokenDoc) {
      return next(new AppError("Invalid or expired reset token", 400, "INVALID_TOKEN"));
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
