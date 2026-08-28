export const getJwtAccessSecret = (): string => {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.JWT_ACCESS_SECRET) {
      console.error("FATAL ERROR: JWT_ACCESS_SECRET environment variable is missing in production.");
      process.exit(1);
    }
    return process.env.JWT_ACCESS_SECRET;
  }
  return process.env.JWT_ACCESS_SECRET || "dev_fallback_access_secret_only";
};

export const getJwtRefreshSecret = (): string => {
  if (process.env.NODE_ENV === "production") {
    if (!process.env.JWT_REFRESH_SECRET) {
      console.error("FATAL ERROR: JWT_REFRESH_SECRET environment variable is missing in production.");
      process.exit(1);
    }
    return process.env.JWT_REFRESH_SECRET;
  }
  return process.env.JWT_REFRESH_SECRET || "dev_fallback_refresh_secret_only";
};

export const validateProductionEnv = (): void => {
  if (process.env.NODE_ENV === "production") {
    const missing: string[] = [];

    if (!process.env.JWT_ACCESS_SECRET) missing.push("JWT_ACCESS_SECRET");
    if (!process.env.JWT_REFRESH_SECRET) missing.push("JWT_REFRESH_SECRET");
    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === "dummy_key") missing.push("RAZORPAY_KEY_ID");
    if (!process.env.RAZORPAY_KEY_SECRET) missing.push("RAZORPAY_KEY_SECRET");
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) missing.push("RAZORPAY_WEBHOOK_SECRET");
    if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");
    if ((process.env.LOGISTICS_PROVIDER || '').toLowerCase() === 'delhivery' && !process.env.DELHIVERY_API_TOKEN) {
      missing.push("DELHIVERY_API_TOKEN");
    }
    if ((process.env.EMAIL_PROVIDER || '').toLowerCase() === 'brevo') {
      if (!process.env.BREVO_API_KEY && !process.env.EMAIL_API_KEY) missing.push("BREVO_API_KEY");
      if (!process.env.EMAIL_FROM) missing.push("EMAIL_FROM");
    }

    if (missing.length > 0) {
      console.error(`FATAL ERROR: Missing required production environment variables: ${missing.join(", ")}`);
      process.exit(1);
    }
  }
};
