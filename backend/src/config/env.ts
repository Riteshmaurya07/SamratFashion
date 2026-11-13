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

import { isCustomDesignEnabled } from "./features";

export const isStrictProductionOrStaging = (): boolean => {
  const env = (process.env.NODE_ENV || "").toLowerCase();
  return env === "production" || env === "staging";
};

export const validateProductionEnv = (): void => {
  validateMandatorySecrets();

  const isStrict = isStrictProductionOrStaging();

  if (isStrict) {
    // Forbid mock payment mode in production and staging
    if (process.env.ALLOW_PAYMENT_MOCK === "true") {
      console.error("FATAL SECURITY ERROR: ALLOW_PAYMENT_MOCK=true is strictly forbidden in production and staging environments.");
      throw new Error("SECURITY_CONFIG_ERROR: ALLOW_PAYMENT_MOCK is strictly forbidden in production and staging environments.");
    }

    // Forbid every mock authentication/email switch in production and staging.
    // These flags bypass Google signature verification and can disclose
    // password-reset tokens, so an insecure value must be a fatal boot error.
    const forbiddenAuthMocks = [
      { name: "ALLOW_AUTH_MOCK", value: process.env.ALLOW_AUTH_MOCK },
      { name: "ALLOW_EMAIL_MOCK", value: process.env.ALLOW_EMAIL_MOCK },
    ];

    for (const flag of forbiddenAuthMocks) {
      if ((flag.value || "").toLowerCase() === "true") {
        console.error(
          `FATAL SECURITY ERROR: ${flag.name}=true is strictly forbidden in production and staging environments.`
        );
        throw new Error(
          `SECURITY_CONFIG_ERROR: ${flag.name} is strictly forbidden in production and staging environments.`
        );
      }
    }

    // Custom Design/Custom Printing must stay disabled unless an explicit future release approval is present.
    if (isCustomDesignEnabled() && process.env.CUSTOM_DESIGN_RELEASE_APPROVED !== "true") {
      console.error("FATAL SECURITY ERROR: ENABLE_CUSTOM_DESIGN=true is forbidden in production and staging without CUSTOM_DESIGN_RELEASE_APPROVED=true.");
      throw new Error("SECURITY_CONFIG_ERROR: ENABLE_CUSTOM_DESIGN requires CUSTOM_DESIGN_RELEASE_APPROVED=true in production and staging environments.");
    }

    const missing: string[] = [];

    if (!process.env.JWT_ACCESS_SECRET) missing.push("JWT_ACCESS_SECRET");
    if (!process.env.JWT_REFRESH_SECRET) missing.push("JWT_REFRESH_SECRET");
    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID === "dummy_key" || process.env.RAZORPAY_KEY_ID.includes("dummy")) {
      missing.push("RAZORPAY_KEY_ID");
    }
    if (!process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET === "dummy_secret") {
      missing.push("RAZORPAY_KEY_SECRET");
    }
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) missing.push("RAZORPAY_WEBHOOK_SECRET");
    if (process.env.TURNSTILE_ENABLED === "true" && !process.env.TURNSTILE_SECRET_KEY) {
      missing.push("TURNSTILE_SECRET_KEY");
    }
    if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");
    const logisticsProvider = (process.env.LOGISTICS_PROVIDER || 'nimbuspost').toLowerCase();
    if (logisticsProvider === 'nimbuspost') {
      if (!process.env.NIMBUSPOST_API_KEY) missing.push("NIMBUSPOST_API_KEY");
      if (!process.env.NIMBUSPOST_API_SECRET) missing.push("NIMBUSPOST_API_SECRET");
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
      console.error(`FATAL ERROR: Missing required environment variables: ${missing.join(", ")}`);
      throw new Error(`CONFIG_ERROR: Missing required environment variables: ${missing.join(", ")}`);
    }

    if (process.env.TURNSTILE_ENABLED !== "true") {
      console.warn(
        "[SECURITY] TURNSTILE_ENABLED is not 'true': login, registration and password-reset CAPTCHA is disabled in production."
      );
    }
  }
};
