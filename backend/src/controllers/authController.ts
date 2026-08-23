import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User, UserStatus } from "../models/User";
import { Session } from "../models/Session";
import { PasswordResetToken } from "../models/PasswordResetToken";
import { emailService } from "../services/emailService";
import { AppError } from "../utils/AppError";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "../utils/validation";

if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error("FATAL: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET environment variables must be defined in production.");
  }
}

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || "dev_fallback_access_secret_only";
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || "dev_fallback_refresh_secret_only";
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN_DAYS = 7;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/", // Or restrict to /api/auth/refresh for better security
  maxAge: REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
};

const generateTokens = (userId: string, role: string) => {
  const accessToken = jwt.sign({ sub: userId, role }, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
  const refreshToken = crypto.randomBytes(40).toString("hex");
  return { accessToken, refreshToken };
};

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = registerSchema.parse(req.body);

    const existingUser = await User.findOne({ 
      $or: [
        { email: validatedData.email },
        ...(validatedData.phone ? [{ phone: validatedData.phone }] : [])
      ]
    });

    if (existingUser) {
      if (existingUser.email === validatedData.email) {
        return next(new AppError("Email is already registered", 409, "DUPLICATE_EMAIL"));
      }
      return next(new AppError("Phone number is already registered", 409, "DUPLICATE_PHONE"));
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(validatedData.password, salt);

    const newUser = await User.create({
      name: validatedData.name,
      email: validatedData.email,
      phone: validatedData.phone,
      passwordHash,
    });

    const { accessToken, refreshToken } = generateTokens(newUser._id.toString(), newUser.role);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + cookieOptions.maxAge);

    await Session.create({
      userId: newUser._id,
      refreshTokenHash,
      expiresAt,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

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

    const user = await User.findOne({ email: validatedData.email });
    if (!user) {
      return next(new AppError("Email or password is incorrect", 401, "AUTH_FAILED"));
    }

    if (user.status === UserStatus.SUSPENDED) {
      return next(new AppError("Your account is currently unavailable. Please contact support.", 403, "ACCOUNT_SUSPENDED"));
    }
    if (user.status === UserStatus.DISABLED) {
      return next(new AppError("Email or password is incorrect", 401, "AUTH_FAILED"));
    }

    const isMatch = await bcrypt.compare(validatedData.password, user.passwordHash);
    if (!isMatch) {
      return next(new AppError("Email or password is incorrect", 401, "AUTH_FAILED"));
    }

    user.lastLoginAt = new Date();
    await user.save();

    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.role);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const expiresAt = new Date(Date.now() + cookieOptions.maxAge);

    await Session.create({
      userId: user._id,
      refreshTokenHash,
      expiresAt,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

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

export const refresh = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }

    // Find all active sessions that could possibly match
    const sessions = await Session.find({ expiresAt: { $gt: new Date() }, revokedAt: { $exists: false } });
    let validSession = null;

    for (const session of sessions) {
      const isMatch = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      if (isMatch) {
        validSession = session;
        break;
      }
    }

    if (!validSession) {
      res.clearCookie("refreshToken");
      return next(new AppError("Session expired or invalid", 401, "SESSION_EXPIRED"));
    }

    const user = await User.findById(validSession.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      res.clearCookie("refreshToken");
      return next(new AppError("User account issue", 401, "UNAUTHORIZED"));
    }

    // Rotate refresh token
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id.toString(), user.role);
    const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    
    // Revoke old session
    validSession.revokedAt = new Date();
    await validSession.save();

    // Create new session
    const expiresAt = new Date(Date.now() + cookieOptions.maxAge);
    await Session.create({
      userId: user._id,
      refreshTokenHash: newRefreshTokenHash,
      expiresAt,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });

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
      const sessions = await Session.find({ revokedAt: { $exists: false } });
      for (const session of sessions) {
        const isMatch = await bcrypt.compare(refreshToken, session.refreshTokenHash);
        if (isMatch) {
          session.revokedAt = new Date();
          await session.save();
          break;
        }
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
    const user = await User.findOne({ email: validatedData.email });

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

    await emailService.sendPasswordResetEmail(user.email, resetToken);

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
