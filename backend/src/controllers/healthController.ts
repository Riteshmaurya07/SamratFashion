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

  const hasRazorpayConfig = Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_KEY_ID !== 'dummy_key'
  );

  const logisticsProviderType = (process.env.LOGISTICS_PROVIDER || 'mock').toLowerCase();
  const hasLogisticsConfig = logisticsProviderType === 'delhivery'
    ? Boolean(process.env.DELHIVERY_API_TOKEN)
    : logisticsProviderType === 'mock'
      ? Boolean(process.env.ALLOW_LOGISTICS_MOCK === 'true' || process.env.NODE_ENV !== 'production')
      : false;

  const emailProviderType = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
  const hasEmailConfig = emailProviderType === 'brevo'
    ? Boolean(process.env.BREVO_API_KEY || process.env.EMAIL_API_KEY)
    : emailProviderType === 'console'
      ? true
      : false;

  const overallSystemStatus = isDbConnected && hasRazorpayConfig ? 'HEALTHY' : isDbConnected ? 'DEGRADED' : 'UNAVAILABLE';

  res.status(200).json({
    status: overallSystemStatus,
    database: isDbConnected ? 'CONNECTED' : 'DISCONNECTED',
    paymentProvider: {
      provider: 'RAZORPAY',
      status: hasRazorpayConfig ? 'CONFIGURED' : 'NOT_CONFIGURED',
      verificationType: 'CONFIGURATION_ONLY'
    },
    logisticsProvider: {
      provider: logisticsProviderType.toUpperCase(),
      status: hasLogisticsConfig ? 'CONFIGURED' : 'NOT_CONFIGURED',
      verificationType: 'CONFIGURATION_ONLY'
    },
    emailProvider: {
      provider: emailProviderType.toUpperCase(),
      status: hasEmailConfig ? 'CONFIGURED' : 'NOT_CONFIGURED',
      verificationType: 'CONFIGURATION_ONLY'
    },
    requestId: obsReq.requestId || 'unknown'
  });
};
