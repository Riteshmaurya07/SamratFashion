import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
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
import adminRoutes from "./routes/adminRoutes";
import customDesignRoutes from "./routes/customDesignRoutes";
import pricingRoutes from "./routes/pricingRoutes";
import customTemplateRoutes from "./routes/customTemplateRoutes";
import healthRoutes from "./routes/healthRoutes";
import aiRoutes from "./routes/aiRoutes";

import { validateProductionEnv, validateMandatorySecrets } from "./config/env";
import { startOrderExpiryScheduler } from "./services/orderExpiryService";


// Validate mandatory environment secrets on server boot
validateMandatorySecrets();
validateProductionEnv();

const app = express();
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Connect to MongoDB
connectDB();

// Start the stale PENDING-order expiry reaper once the DB is reachable. Skips itself
// under NODE_ENV=test so test suites drive expireStalePendingOrders() directly.
if (mongoose.connection.readyState === 1) {
  startOrderExpiryScheduler();
} else {
  mongoose.connection.once("connected", startOrderExpiryScheduler);
}

// Observability Middleware
app.use(requestIdMiddleware);
app.use(structuredLoggingMiddleware);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,
}));

// Webhook route needs raw body
app.use("/api/webhooks", express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

import adminCustomOrderRoutes from "./routes/adminCustomOrderRoutes";
import printPlacementRoutes from "./routes/printPlacementRoutes";
import adminPrintPlacementRoutes from "./routes/adminPrintPlacementRoutes";
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
import fs from "fs";

// Static Uploads Directory
const uploadsDir = path.resolve(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir, {
  setHeaders: (res, path) => {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
  }
}));

// Health Routes
app.use("/health", healthRoutes);
app.use("/api/health", healthRoutes);

// Feature Routes
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/catalog", cmsCatalogRoutes);
app.use("/api/catalog/cms", cmsCatalogRoutes);
app.use("/api/admin", adminCatalogRoutes);
// Mount the more specific custom-orders router FIRST so GET /custom-orders and
// GET /custom-orders/:id resolve here; the generic admin router's legacy handlers
// for those paths (a different, incompatible response shape) become dead.
app.use("/api/admin/custom-orders", adminCustomOrderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/print-placements", printPlacementRoutes);
app.use("/api/admin/print-placements", adminPrintPlacementRoutes);
app.use("/api/admin/production", adminProductionRoutes);
app.use("/api/admin/reviews", adminReviewRoutes);
app.use("/api/admin/support", adminSupportRoutes);
app.use("/api/admin/cms", adminCmsRoutes);
app.use("/api/admin/bulk-orders", adminBulkOrderRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/designs", customDesignRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api/custom-templates", customTemplateRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/bulk-orders", bulkOrderRoutes);
app.use("/api/custom-print-catalog", customPrintCatalogRoutes);
app.use("/api/admin/custom-print-catalog", adminCustomPrintCatalogRoutes);
app.use("/api/admin/print-catalog", adminCustomPrintCatalogRoutes);
app.use("/api/admin/print-pricing", adminPrintPricingRoutes);
app.use("/api/admin/pricing-configs", adminPrintPricingRoutes);
app.use("/api/ai", aiRoutes);

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
