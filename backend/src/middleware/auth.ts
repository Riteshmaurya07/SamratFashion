import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/AppError";
import { getJwtAccessSecret } from "../config/env";

interface JwtPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(new AppError("Not authenticated", 401, "UNAUTHORIZED"));
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, getJwtAccessSecret()) as JwtPayload;

    (req as any).user = {
      id: decoded.sub,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return next(new AppError("Token expired", 401, "TOKEN_EXPIRED"));
    }
    return next(new AppError("Invalid token", 401, "UNAUTHORIZED"));
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
