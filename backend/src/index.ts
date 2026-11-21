import dotenv from "dotenv";
import path from "path";
import http from "http";
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { errorHandler } from "./middleware/errorHandler";
import { requestIdMiddleware, structuredLoggingMiddleware } from "./middleware/observability";
import { AppError } from "./utils/AppError";
import { connectDB } from "./config/db";
import authRoutes from "./routes/authRoutes";
import catalogRoutes from "./routes/catalogRoutes";
import adminCatalogRoutes from "./routes/adminCatalogRoutes";
import cartRoutes from "./routes/cartRoutes";
import wishlistRoutes from "./routes/wishlistRoutes";
import addressRoutes from "./routes/addressRoutes";
import orderRoutes from "./routes/orderRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import webhookRoutes from "./routes/webhookRoutes";
import { razorpayWebhook } from "./controllers/webhookController";
import adminRoutes from "./routes/adminRoutes";
import customDesignRoutes from "./routes/customDesignRoutes";
import pricingRoutes from "./routes/pricingRoutes";
import customTemplateRoutes from "./routes/customTemplateRoutes";
import healthRoutes from "./routes/healthRoutes";
import opsRoutes from "./routes/opsRoutes";
import aiRoutes from "./routes/aiRoutes";

import { validateProductionEnv, validateMandatorySecrets, isStrictProductionOrStaging } from "./config/env";
import { globalLimiter } from "./middleware/rateLimiters";
import { requireCustomDesignEnabled, requireBulkOrderEnabled } from "./config/features";
import { startOrderExpiryScheduler, stopOrderExpiryScheduler } from "./services/orderExpiryService";
import { startLogCleanupScheduler, stopLogCleanupScheduler } from "./services/logCleanupService";
import { disconnectDB } from "./config/db";
import { RecoveryCoordinatorService } from "./services/recovery/recoveryCoordinatorService";
import adminRecoveryRoutes from "./routes/adminRecoveryRoutes";

// Validate mandatory environment secrets on server boot
validateMandatorySecrets();
validateProductionEnv();

const app = express();
const PORT = process.env.PORT || 5000;

if (isStrictProductionOrStaging()) {
  app.set("trust proxy", 1);
}

let serverInstance: http.Server | null = null;

export async function startServer(): Promise<http.Server> {
  // Await database connection before accepting application traffic
  await connectDB();

  if (process.env.NODE_ENV !== "test") {
    if (process.env.DISABLE_EMBEDDED_RECOVERY === "true") {
      // External coordinated recovery (GET/POST /api/ops/recovery/run) owns
      // refund reconciliation, webhook replay, cancellation recovery and order
      // expiry. Do not start a second in-process timer that could race it.
      console.log(
        "[SCHEDULER] DISABLE_EMBEDDED_RECOVERY=true: recovery and order expiry run via the external ops trigger."
      );
    } else {
      startOrderExpiryScheduler();
      RecoveryCoordinatorService.startRecoveryScheduler();
    }
    startLogCleanupScheduler();
  }
  return new Promise<http.Server>((resolve, reject) => {
    serverInstance = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      resolve(serverInstance!);
    });
    serverInstance.on("error", reject);
  });
}

// Observability Middleware
app.use(requestIdMiddleware);
app.use(structuredLoggingMiddleware);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));

// Webhook routes need raw body before standard JSON parsing
app.use("/api/webhooks", express.raw({ type: 'application/json' }), webhookRoutes);
app.use("/api/v1/payments/webhook", express.raw({ type: 'application/json' }), razorpayWebhook);
app.use("/api/payments/webhook", express.raw({ type: 'application/json' }), razorpayWebhook);

// Global API Rate Limiter (L3: ~300 req / 15 min / IP)
app.use("/api", globalLimiter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Fallback: Ensure req.body is always initialized to an object if undefined after body parsing
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.body === undefined) {
    req.body = {};
  }
  next();
});

// MongoDB operator injection sanitizer (N-M11)
function sanitizeMongoInPlace(obj: any): void {
  if (obj !== null && typeof obj === "object") {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (typeof obj[i] === "object" && obj[i] !== null) {
          sanitizeMongoInPlace(obj[i]);
        }
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (key.startsWith("$") || key.includes(".")) {
          delete obj[key];
        } else if (typeof obj[key] === "object" && obj[key] !== null) {
          sanitizeMongoInPlace(obj[key]);
        }
      }
    }
  }
}

app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.body) sanitizeMongoInPlace(req.body);
  if (req.query) sanitizeMongoInPlace(req.query);
  if (req.params) sanitizeMongoInPlace(req.params);
  next();
});

import adminCustomOrderRoutes from "./routes/adminCustomOrderRoutes";
import adminProductionRoutes from "./routes/adminProductionRoutes";
import reviewRoutes from "./routes/reviewRoutes";
import adminReviewRoutes from "./routes/adminReviewRoutes";
import supportRoutes from "./routes/supportRoutes";
import adminSupportRoutes from "./routes/adminSupportRoutes";
import cmsCatalogRoutes from "./routes/cmsCatalogRoutes";
import adminCmsRoutes from "./routes/adminCmsRoutes";
import bulkOrderRoutes from "./routes/bulkOrderRoutes";
import adminBulkOrderRoutes from "./routes/adminBulkOrderRoutes";
import shippingRoutes from "./routes/shippingRoutes";
import uploadRoutes from "./routes/uploadRoutes";
import customPrintCatalogRoutes from "./routes/customPrintCatalogRoutes";
import adminCustomPrintCatalogRoutes from "./routes/adminCustomPrintCatalogRoutes";
import adminPrintPricingRoutes from "./routes/adminPrintPricingRoutes";
import adminTeamRoutes from "./routes/adminTeamRoutes";
import storeSettingsRoutes from "./routes/storeSettingsRoutes";
import fs from "fs";
import { isPublicUploadPath } from "./utils/uploadPathSecurity";

// Static Uploads Directory
const uploadsDir = path.resolve(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
// Public asset allowlist. Only product, banner and review directories may be
// served statically. Private customer artwork is intentionally excluded, and
// the guard decodes encoded/double-encoded paths before making the decision so
// `%63ustom-designs` or `%252e%252e` cannot bypass it. Unknown and malformed
// paths fail closed.
app.use("/uploads", (req, res, next) => {
  if (!isPublicUploadPath(req.path)) {
    return res.status(404).json({ success: false, message: "Not found", code: "NOT_FOUND" });
  }
  next();
});
app.use("/uploads", express.static(uploadsDir, {
  dotfiles: "deny",
  index: false,
  redirect: false,
  fallthrough: false,
  setHeaders: (res) => {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("X-Content-Type-Options", "nosniff");
  }
}));
// `fallthrough: false` turns a missing file into an error. Translate the static
// miss back to the guard's JSON 404 so a missing public asset is not reported as
// a 500 by the global error handler.
app.use("/uploads", (err: any, _req: Request, res: Response, next: NextFunction) => {
  const status = err?.statusCode ?? err?.status;
  if (status === 404 || err?.code === "ENOENT") {
    return res.status(404).json({ success: false, message: "Not found", code: "NOT_FOUND" });
  }
  if (status === 403) {
    return res.status(403).json({ success: false, message: "Forbidden", code: "FORBIDDEN" });
  }
  next(err);
});

// Health Routes
app.use("/health", healthRoutes);
app.use("/api/health", healthRoutes);

// Operational health + cron-triggered recovery (shared-secret authenticated).
// Required on serverless hosts where the embedded scheduler cannot run.
app.use("/api/ops", opsRoutes);

// Feature Routes
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/store-settings", storeSettingsRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/catalog", cmsCatalogRoutes);
app.use("/api/catalog/cms", cmsCatalogRoutes);
app.use("/api/admin", adminCatalogRoutes);
// Mount the more specific custom-orders router FIRST so GET /custom-orders and
// GET /custom-orders/:id resolve here; the generic admin router's legacy handlers
// for those paths (a different, incompatible response shape) become dead.
app.use("/api/admin/custom-orders", requireCustomDesignEnabled, adminCustomOrderRoutes);
app.use("/api/admin/recovery", adminRecoveryRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/production", requireCustomDesignEnabled, adminProductionRoutes);
app.use("/api/admin/reviews", adminReviewRoutes);
app.use("/api/admin/support", adminSupportRoutes);
app.use("/api/admin/cms", adminCmsRoutes);
app.use("/api/admin/bulk-orders", requireBulkOrderEnabled, adminBulkOrderRoutes);
app.use("/api/admin/team", adminTeamRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/designs", requireCustomDesignEnabled, customDesignRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/custom-templates", requireCustomDesignEnabled, customTemplateRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/bulk-orders", requireBulkOrderEnabled, bulkOrderRoutes);
app.use("/api/custom-print-catalog", requireCustomDesignEnabled, customPrintCatalogRoutes);
app.use("/api/admin/custom-print-catalog", requireCustomDesignEnabled, adminCustomPrintCatalogRoutes);
app.use("/api/admin/print-catalog", requireCustomDesignEnabled, adminCustomPrintCatalogRoutes);
app.use("/api/admin/print-pricing", requireCustomDesignEnabled, adminPrintPricingRoutes);
app.use("/api/admin/pricing-configs", requireCustomDesignEnabled, adminPrintPricingRoutes);
app.use("/api/ai", requireCustomDesignEnabled, aiRoutes);

// 404 Handler
app.use((req: Request, res: Response, next) => {
  next(new AppError(`Cannot find ${req.originalUrl} on this server`, 404, "NOT_FOUND"));
});

// Global Error Handler
app.use(errorHandler);

// Process Safety & Unhandled Rejection Guards
process.on("uncaughtException", (err: Error) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    service: "samrat-fashion-backend",
    event: "UNCAUGHT_EXCEPTION",
    message: err.message
  }));
});

process.on("unhandledRejection", (reason: any) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "ERROR",
    service: "samrat-fashion-backend",
    event: "UNHANDLED_REJECTION",
    reason: typeof reason === "object" ? reason.message || "Unknown error" : String(reason)
  }));
});

let isServerShuttingDown = false;
export const handleGracefulShutdown = async (signal: string): Promise<boolean> => {
  if (isServerShuttingDown) {
    console.log(`[SERVER] Shutdown already in progress. Ignoring duplicate ${signal}.`);
    return false;
  }
  isServerShuttingDown = true;
  console.log(`[SERVER] Received ${signal}. Starting graceful shutdown...`);

  // 1. Stop accepting new HTTP requests immediately
  if (serverInstance) {
    await new Promise<void>((resolve) => {
      serverInstance!.close(() => {
        console.log('[SERVER] HTTP server closed.');
        resolve();
      });
    });
  }

  // 2. Stop schedulers and cancel pending startup timers
  RecoveryCoordinatorService.stopRecoveryScheduler();
  stopOrderExpiryScheduler();
  stopLogCleanupScheduler();

  // 3. Drain active recovery work before disconnecting MongoDB
  const drainResult = await RecoveryCoordinatorService.drainAndShutdown({
    drainTimeoutMs: 15000,
    disconnectDbFn: disconnectDB
  });

  if (!drainResult.drained) {
    console.error(`[SERVER] Incomplete drain: ${drainResult.message}`);
    return false;
  }

  console.log('[SERVER] Graceful shutdown complete.');
  return true;
};

process.on('SIGTERM', async () => {
  const ok = await handleGracefulShutdown('SIGTERM');
  if (process.env.NODE_ENV !== 'test') {
    process.exit(ok ? 0 : 1);
  }
});
process.on('SIGINT', async () => {
  const ok = await handleGracefulShutdown('SIGINT');
  if (process.env.NODE_ENV !== 'test') {
    process.exit(ok ? 0 : 1);
  }
});
if (process.env.NODE_ENV !== "test") {
  startServer().catch((err) => {
    console.error("FATAL: Failed to initialize backend server:", err);
    process.exit(1);
  });
}

export { app, serverInstance };
