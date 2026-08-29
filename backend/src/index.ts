import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
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
import adminRoutes from "./routes/adminRoutes";
import customDesignRoutes from "./routes/customDesignRoutes";
import healthRoutes from "./routes/healthRoutes";

import { validateProductionEnv } from "./config/env";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Validate environment secrets in production mode
validateProductionEnv();

const app = express();
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// Connect to MongoDB
connectDB();

// Observability Middleware
app.use(requestIdMiddleware);
app.use(structuredLoggingMiddleware);

// Middleware
app.use(helmet());
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

// Health Routes
app.use("/health", healthRoutes);
app.use("/api/health", healthRoutes);

// Feature Routes
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/catalog/cms", cmsCatalogRoutes);
app.use("/api/admin", adminCatalogRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/custom-orders", adminCustomOrderRoutes);
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
app.use("/api/reviews", reviewRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/bulk-orders", bulkOrderRoutes);

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
