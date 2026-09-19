export const getJwtAccessSecret = (): string => {
  if (!process.env.JWT_ACCESS_SECRET) {
    console.error("FATAL ERROR: JWT_ACCESS_SECRET environment variable is missing.");
    throw new Error("FATAL ERROR: JWT_ACCESS_SECRET environment variable is missing.");
  }
  return process.env.JWT_ACCESS_SECRET;
};

export const getJwtRefreshSecret = (): string => {
  if (!process.env.JWT_REFRESH_SECRET) {
    console.error("FATAL ERROR: JWT_REFRESH_SECRET environment variable is missing.");
    throw new Error("FATAL ERROR: JWT_REFRESH_SECRET environment variable is missing.");
  }
  return process.env.JWT_REFRESH_SECRET;
};

export const validateMandatorySecrets = (): void => {
  getJwtAccessSecret();
  getJwtRefreshSecret();
};

export const validateProductionEnv = (): void => {
  validateMandatorySecrets();

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
    if ((process.env.IMAGE_PROVIDER || '').toLowerCase() === 'cloudinary') {
      if (!process.env.CLOUDINARY_CLOUD_NAME) missing.push("CLOUDINARY_CLOUD_NAME");
      if (!process.env.CLOUDINARY_API_KEY) missing.push("CLOUDINARY_API_KEY");
      if (!process.env.CLOUDINARY_API_SECRET) missing.push("CLOUDINARY_API_SECRET");
    }

    if (missing.length > 0) {
      console.error(`FATAL ERROR: Missing required production environment variables: ${missing.join(", ")}`);
      throw new Error(`IMAGE_PROVIDER_CONFIG_ERROR: Missing required environment variables: ${missing.join(", ")}`);
    }
  }
};
