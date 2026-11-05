import { AppError } from "../utils/AppError";

export const isCustomDesignEnabled = (): boolean => {
  const value = process.env.ENABLE_CUSTOM_DESIGN;
  if (value == null || value.trim() === "") {
    return false;
  }
  return value.trim().toLowerCase() === "true";
};

export const requireCustomDesignEnabled = (req: any, res: any, next: any) => {
  if (!isCustomDesignEnabled()) {
    return next(new AppError("Custom design features are disabled for this deployment", 503, "CUSTOM_DESIGN_DISABLED"));
  }
  next();
};
