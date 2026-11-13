import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";

export const isCustomDesignEnabled = (): boolean => {
  const value = process.env.ENABLE_CUSTOM_DESIGN;
  if (value == null || value.trim() === "") {
    return false;
  }
  return value.trim().toLowerCase() === "true";
};

export const requireCustomDesignEnabled = (_req: Request, _res: Response, next: NextFunction): void => {
  if (!isCustomDesignEnabled()) {
    return next(new AppError("Custom design features are disabled for this deployment", 503, "CUSTOM_DESIGN_DISABLED"));
  }
  next();
};

export const isBulkOrderEnabled = (): boolean => {
  const value = process.env.ENABLE_BULK_ORDERS;
  if (value == null || value.trim() === "") {
    return false;
  }
  return value.trim().toLowerCase() === "true";
};

export const requireBulkOrderEnabled = (_req: Request, _res: Response, next: NextFunction): void => {
  if (!isBulkOrderEnabled()) {
    return next(new AppError("Bulk order features are disabled for this deployment", 503, "BULK_ORDERS_DISABLED"));
  }
  next();
};
