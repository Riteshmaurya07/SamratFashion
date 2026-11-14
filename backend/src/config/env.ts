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
    if (!process.env.MONGODB_URI && process.env.Mongodb_URI) {
      process.env.MONGODB_URI = process.env.Mongodb_URI;
    }
    if (!process.env.MONGODB_URI) missing.push("MONGODB_URI");
    const logisticsProvider = (process.env.LOGISTICS_PROVIDER || 'nimbuspost').toLowerCase();
    if (logisticsProvider === 'nimbuspost') {
      if (!process.env.NIMBUSPOST_API_KEY) missing.push("NIMBUSPOST_API_KEY");
      if (!process.env.NIMBUSPOST_API_SECRET) missing.push("NIMBUSPOST_API_SECRET");
    }
    const emailProvider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const allowedProdEmailProviders = ['brevo', 'smtp', 'resend'];
    if (!emailProvider || emailProvider === 'console') {
      missing.push("EMAIL_PROVIDER (required in production: 'brevo', 'smtp', or 'resend'; 'console' is forbidden)");
    } else if (!allowedProdEmailProviders.includes(emailProvider)) {
      missing.push(`EMAIL_PROVIDER '${emailProvider}' is unsupported in production (must be 'brevo', 'smtp', or 'resend')`);
    } else {
      if (!process.env.EMAIL_FROM || !process.env.EMAIL_FROM.includes('@')) {
        missing.push("EMAIL_FROM (valid sender email address required)");
      }
      if (emailProvider === 'brevo') {
        const brevoKey = process.env.BREVO_API_KEY || process.env.EMAIL_API_KEY;
        if (!brevoKey || brevoKey.includes('your_') || brevoKey === 'dummy_key') {
          missing.push("BREVO_API_KEY (or EMAIL_API_KEY)");
        }
        if (brevoKey?.startsWith('xsmtpsib-') && !process.env.SMTP_USER) {
          missing.push("SMTP_USER (required when using Brevo SMTP key starting with xsmtpsib-)");
        }
      } else if (emailProvider === 'smtp') {
        if (!process.env.SMTP_HOST) missing.push("SMTP_HOST");
        if (!process.env.SMTP_USER) missing.push("SMTP_USER");
        if (!process.env.SMTP_PASS) missing.push("SMTP_PASS");
      } else if (emailProvider === 'resend') {
        if (!process.env.EMAIL_API_KEY) missing.push("EMAIL_API_KEY");
      }
    }

    const imageProvider = (process.env.IMAGE_PROVIDER || '').trim().toLowerCase();
    if (!imageProvider || imageProvider === 'local') {
      missing.push("IMAGE_PROVIDER (must be 'cloudinary' in production/staging; local disk storage is ephemeral)");
    } else if (imageProvider === 'cloudinary') {
      if (!process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME.includes('your_')) {
        missing.push("CLOUDINARY_CLOUD_NAME");
      }
      if (!process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_API_KEY.includes('your_')) {
        missing.push("CLOUDINARY_API_KEY");
      }
      if (!process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_API_SECRET.includes('your_')) {
        missing.push("CLOUDINARY_API_SECRET");
      }
    } else {
      missing.push(`IMAGE_PROVIDER '${imageProvider}' is unsupported in production (must be 'cloudinary')`);
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
