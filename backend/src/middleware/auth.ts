import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/AppError";
import { getJwtAccessSecret } from "../config/env";
import { User, UserStatus } from "../models/User";

interface JwtPayload {
  sub: string;
  role: string;
  tokenVersion?: number;
  iat: number;
  exp: number;
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined = undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies && (req.cookies.accessToken || req.cookies.token)) {
      token = req.cookies.accessToken || req.cookies.token;
    }
    if (!token) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }
    // Pin the algorithm so an attacker cannot slip in a "none" or asymmetric algorithm.
    const decoded = jwt.verify(token, getJwtAccessSecret(), { algorithms: ["HS256"] }) as JwtPayload;

    // Load the user document so status changes (SUSPENDED / DISABLED) and token revocation take effect immediately
    const user = await User.findById(decoded.sub).select("_id role status emailVerified tokenVersion customRoleId");

    if (!user) {
      return next(new AppError("Invalid token", 401, "UNAUTHORIZED"));
    }
    if (user.status !== UserStatus.ACTIVE) {
      // Do not disclose the exact reason to a stale-token caller.
      return next(new AppError("Session is no longer available", 401, "UNAUTHORIZED"));
    }

    // N-M10: Token version invalidation (logout-all, password reset)
    if (
      decoded.tokenVersion !== undefined &&
      user.tokenVersion !== undefined &&
      decoded.tokenVersion !== user.tokenVersion
    ) {
      return next(new AppError("Session is no longer valid. Please log in again.", 401, "UNAUTHORIZED"));
    }

    // N-M9: Enforce email verification on sensitive state-mutating (write) endpoints
    // (Orders, Checkout, Payments, Reviews, Addresses, Support, Uploads).
    // Shopping utilities (Cart, Wishlist) and Auth/Verification endpoints are exempted
    // so registered customers can freely browse, add to bag, and manage favorites.
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());
    const isExempt =
      req.baseUrl?.includes("/auth") ||
      req.originalUrl?.includes("/auth/") ||
      req.originalUrl?.includes("/cart") ||
      req.originalUrl?.includes("/wishlist") ||
      req.path?.includes("/verify") ||
      req.path?.includes("/resend") ||
      req.path?.includes("/logout");

    if (isWrite && !isExempt && !user.emailVerified) {
      return next(
        new AppError(
          "Please verify your email address before performing this action.",
          403,
          "EMAIL_NOT_VERIFIED"
        )
      );
    }

    (req as any).user = {
      id: user._id.toString(),
      _id: user._id,
      role: user.role,
      emailVerified: Boolean(user.emailVerified),
      customRoleId: (user as any).customRoleId || null,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError("Token expired", 401, "TOKEN_EXPIRED"));
    }
    return next(new AppError("Invalid token", 401, "UNAUTHORIZED"));
  }
};
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined = undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.cookies && (req.cookies.accessToken || req.cookies.token)) {
      token = req.cookies.accessToken || req.cookies.token;
    }
    if (!token) {
      return next();
    }

    try {
      const decoded = jwt.verify(token, getJwtAccessSecret(), { algorithms: ["HS256"] }) as JwtPayload;
      const user = await User.findById(decoded.sub).select("_id role status");
      if (user && user.status === UserStatus.ACTIVE) {
        (req as any).user = {
          id: user._id.toString(),
          _id: user._id,
          role: user.role,
        };
      }
    } catch {
      // Invalid or expired token - proceed as guest
    }

    next();
  } catch {
    next();
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user?.role;
    
    if (!userRole) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }

    if (!roles.includes(userRole)) {
      return next(new AppError("You do not have permission to perform this action", 403, "FORBIDDEN"));
    }

    next();
  };
};
