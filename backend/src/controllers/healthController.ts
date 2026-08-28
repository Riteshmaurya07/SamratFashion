import { Request, Response } from "express";
import mongoose from "mongoose";
import { ObservableRequest } from "../middleware/observability";

// 1. Liveness Controller (Does not check database/external APIs)
export const getLiveness = (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "samrat-fashion-backend",
    timestamp: new Date().toISOString()
  });
};

// 2. Readiness Controller (Checks database connection readiness)
export const getReadiness = (req: Request, res: Response) => {
  const isDbConnected = mongoose.connection.readyState === 1;

  if (isDbConnected) {
    return res.status(200).json({
      status: "ready",
      database: "connected",
      service: "samrat-fashion-backend"
    });
  }

  return res.status(503).json({
    status: "unavailable",
    database: "disconnected",
    service: "samrat-fashion-backend"
  });
};

// 3. Admin Diagnostics Controller (Requires Admin Role)
export const getAdminDiagnostics = (req: Request, res: Response) => {
  const obsReq = req as ObservableRequest;
  const isDbConnected = mongoose.connection.readyState === 1;

  const logisticsProvider = (process.env.LOGISTICS_PROVIDER || "mock").toLowerCase();
  const emailProvider = (process.env.EMAIL_PROVIDER || "console").toLowerCase();

  const isLogisticsConfigured = logisticsProvider === "delhivery" ? !!process.env.DELHIVERY_API_TOKEN : true;
  const isEmailConfigured = emailProvider === "brevo" ? !!(process.env.BREVO_API_KEY || process.env.EMAIL_API_KEY) : true;

  const systemStatus = isDbConnected && isLogisticsConfigured && isEmailConfigured ? "HEALTHY" : "DEGRADED";

  res.status(200).json({
    status: systemStatus,
    database: isDbConnected ? "CONNECTED" : "DISCONNECTED",
    paymentProvider: process.env.RAZORPAY_KEY_ID ? "HEALTHY" : "DEGRADED",
    logisticsProvider: isLogisticsConfigured ? "HEALTHY" : "NOT_CONFIGURED",
    emailProvider: isEmailConfigured ? "HEALTHY" : "NOT_CONFIGURED",
    requestId: obsReq.requestId || "unknown"
  });
};
