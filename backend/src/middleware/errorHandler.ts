import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = 500;
  let message = "Internal Server Error";
  let code = "INTERNAL_ERROR";
  let errors: any[] = [];

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    code = err.code;
  } else if (err.name === "ZodError") {
    statusCode = 400;
    message = "Validation Error";
    code = "VALIDATION_ERROR";
    errors = (err as any).errors || [];
  } else if (err.name === "ValidationError") {
    statusCode = 400;
    message = err.message;
    code = "MONGO_VALIDATION_ERROR";
  }

  // Do not expose stack traces in production
  if (process.env.NODE_ENV !== "production") {
    if (statusCode >= 500 || !(err instanceof AppError)) {
      console.error(err);
    } else {
      console.warn(`[${statusCode}] ${message}`);
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    errors,
  });
};
