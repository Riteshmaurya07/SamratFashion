import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/AppError";
import { getJwtAccessSecret } from "../config/env";
import { User, UserStatus } from "../models/User";

interface JwtPayload {
  sub: string;
  role: string;
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
    } else if (req.query && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }
    // Pin the algorithm so an attacker cannot slip in a "none" or asymmetric algorithm.
    const decoded = jwt.verify(token, getJwtAccessSecret(), { algorithms: ["HS256"] }) as JwtPayload;

    // Load the user document so status changes (SUSPENDED / DISABLED) take effect immediately,
    // even if the access token is still cryptographically valid.
    const user = await User.findById(decoded.sub).select("_id role status");

    if (!user) {
      return next(new AppError("Invalid token", 401, "UNAUTHORIZED"));
    }
    if (user.status !== UserStatus.ACTIVE) {
      // Do not disclose the exact reason to a stale-token caller.
      return next(new AppError("Session is no longer available", 401, "UNAUTHORIZED"));
    }

    (req as any).user = {
      id: user._id.toString(),
      role: user.role,
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
    } else if (req.query && typeof req.query.token === "string") {
      token = req.query.token;
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
