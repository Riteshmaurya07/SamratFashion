import { Request, Response, NextFunction } from "express";

export interface ObservableRequest extends Request {
  requestId?: string;
  startTime?: number;
}

// 1. Secret & PII Redaction Utility
export function redactSecrets(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;

  const SensitiveKeys = [
    "authorization",
    "cookie",
    "password",
    "passwordhash",
    "token",
    "resettoken",
    "jwt_access_secret",
    "jwt_refresh_secret",
    "razorpay_key_secret",
    "razorpay_webhook_secret",
    "delhivery_api_token",
    "delhivery_webhook_secret",
    "brevo_api_key",
    "apikey",
    "api_key",
    "secret"
  ];

  if (Array.isArray(obj)) {
    return obj.map(item => redactSecrets(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SensitiveKeys.some(s => lowerKey.includes(s))) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object") {
      sanitized[key] = redactSecrets(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// 2. Correlation & Request ID Middleware
export const requestIdMiddleware = (req: ObservableRequest, res: Response, next: NextFunction) => {
  const incomingId = req.headers["x-request-id"] || req.headers["x-correlation-id"];
  
  let requestId: string;
  if (typeof incomingId === "string" && /^[a-zA-Z0-9_\-]+$/.test(incomingId) && incomingId.length <= 64) {
    requestId = incomingId;
  } else {
    requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  req.requestId = requestId;
  req.startTime = Date.now();

  res.setHeader("x-request-id", requestId);
  next();
};

// 3. Structured Logging Middleware
export const structuredLoggingMiddleware = (req: ObservableRequest, res: Response, next: NextFunction) => {
  res.on("finish", () => {
    const durationMs = req.startTime ? Date.now() - req.startTime : 0;
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARN" : "INFO",
      service: "samrat-fashion-backend",
      requestId: req.requestId || "unknown",
      method: req.method,
      route: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs
    };

    // Output structured log safely without flooding dev/test consoles
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_STRUCTURED_LOGS === "true") {
      console.log(JSON.stringify(logEntry));
    }
  });

  next();
};
