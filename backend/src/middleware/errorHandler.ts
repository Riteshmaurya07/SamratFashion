import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/AppError";
import { ObservableRequest } from "./observability";

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const obsReq = req as ObservableRequest;
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
    const zodErr = err as any;
    const formatted = (zodErr.errors || []).map((e: any) => `${e.path?.join(".") || "field"}: ${e.message}`).join("; ");
    message = formatted || "Validation Error";
    code = "VALIDATION_ERROR";
    errors = zodErr.errors || [];
  } else if (err.name === "ValidationError") {
    // Never leak raw MongoDB validation internals (path/rule details) to clients.
    statusCode = 400;
    message = "Invalid request data";
    code = "INVALID_REQUEST_DATA";
    if (process.env.NODE_ENV !== "test") {
      console.warn(`Mongo validation error on ${req.method} ${req.originalUrl}:`, err.message);
    }
  }

  const requestId = obsReq.requestId || "unknown";

  // Server-side structured error logging
  const errorLog = {
    timestamp: new Date().toISOString(),
    level: statusCode >= 500 ? "ERROR" : "WARN",
    service: "samrat-fashion-backend",
    requestId,
    statusCode,
    code,
    message,
    route: req.originalUrl || req.url,
    method: req.method
  };

  if (statusCode >= 500 && process.env.NODE_ENV !== "test") {
    console.error(JSON.stringify(errorLog));
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    errors,
    requestId
  });
};
