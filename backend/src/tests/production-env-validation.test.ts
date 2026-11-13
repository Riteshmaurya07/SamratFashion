import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { validateProductionEnv } from "../config/env";
import { getEmailProvider, ConsoleEmailProvider } from "../services/notifications/emailProviders";
import mongoose from "mongoose";
import { connectSafeTestDb } from "./testHelpers";
import { notificationService } from "../services/notifications/notificationService";
import { verifyDatabaseTransactionSupport } from "../config/db";
let passed = 0;
let failed = 0;

function check(cond: boolean, description: string, details?: string): void {
  if (cond) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description} ${details ? `(${details})` : ""}`);
    failed++;
  }
}

const MANAGED_ENV = [
  "NODE_ENV",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "MONGODB_URI",
  "ALLOW_PAYMENT_MOCK",
  "ALLOW_AUTH_MOCK",
  "ALLOW_EMAIL_MOCK",
  "ENABLE_CUSTOM_DESIGN",
  "LOGISTICS_PROVIDER",
  "NIMBUSPOST_API_KEY",
  "NIMBUSPOST_API_SECRET",
  "EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "EMAIL_API_KEY",
  "EMAIL_FROM",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "IMAGE_PROVIDER",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of MANAGED_ENV) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of MANAGED_ENV) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

function setValidBaseProductionEnv(): void {
  process.env.NODE_ENV = "production";
  process.env.JWT_ACCESS_SECRET = "test_prod_jwt_access_secret_256bit_value";
  process.env.JWT_REFRESH_SECRET = "test_prod_jwt_refresh_secret_256bit_value";
  process.env.RAZORPAY_KEY_ID = "rzp_live_real_key_123456789";
  process.env.RAZORPAY_KEY_SECRET = "real_razorpay_secret_live";
  process.env.RAZORPAY_WEBHOOK_SECRET = "real_webhook_secret";
  process.env.MONGODB_URI = "mongodb+srv://user:pass@cluster.mongodb.net/samrat_fashion_prod?replicaSet=rs0";
  process.env.ALLOW_PAYMENT_MOCK = "false";
  process.env.ALLOW_AUTH_MOCK = "false";
  process.env.ALLOW_EMAIL_MOCK = "false";
  process.env.ENABLE_CUSTOM_DESIGN = "false";
  process.env.LOGISTICS_PROVIDER = "nimbuspost";
  process.env.NIMBUSPOST_API_KEY = "real_nimbus_key";
  process.env.NIMBUSPOST_API_SECRET = "real_nimbus_secret";
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-real-brevo-api-key";
  process.env.EMAIL_FROM = "orders@samratfashion.com";
  process.env.IMAGE_PROVIDER = "cloudinary";
  process.env.CLOUDINARY_CLOUD_NAME = "real_cloud_name";
  process.env.CLOUDINARY_API_KEY = "real_cloudinary_key";
  process.env.CLOUDINARY_API_SECRET = "real_cloudinary_secret";
}

async function runProductionEnvValidationSuite(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Production Environment & Provider Validation Test Suite       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const origEnv = snapshotEnv();

  try {
    console.log("[GROUP 1: Production Email Provider Validation]");

    // 1.1 Unset EMAIL_PROVIDER fails startup
    setValidBaseProductionEnv();
    delete process.env.EMAIL_PROVIDER;
    let errUnsetEmail: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errUnsetEmail = e;
    }
    check(
      errUnsetEmail !== null && errUnsetEmail.message.includes("EMAIL_PROVIDER"),
      "1.1 Unset EMAIL_PROVIDER in production causes fatal boot error",
      errUnsetEmail?.message
    );

    // 1.2 EMAIL_PROVIDER=console fails startup
    setValidBaseProductionEnv();
    process.env.EMAIL_PROVIDER = "console";
    let errConsoleEmail: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errConsoleEmail = e;
    }
    check(
      errConsoleEmail !== null && errConsoleEmail.message.includes("EMAIL_PROVIDER"),
      "1.2 EMAIL_PROVIDER=console in production causes fatal boot error",
      errConsoleEmail?.message
    );

    // 1.3 Missing BREVO_API_KEY when EMAIL_PROVIDER=brevo fails startup
    setValidBaseProductionEnv();
    process.env.EMAIL_PROVIDER = "brevo";
    delete process.env.BREVO_API_KEY;
    delete process.env.EMAIL_API_KEY;
    let errBrevoKey: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errBrevoKey = e;
    }
    check(
      errBrevoKey !== null && errBrevoKey.message.includes("BREVO_API_KEY"),
      "1.3 Missing BREVO_API_KEY when EMAIL_PROVIDER=brevo fails startup",
      errBrevoKey?.message
    );

    // 1.4 Missing EMAIL_FROM fails startup
    setValidBaseProductionEnv();
    delete process.env.EMAIL_FROM;
    let errEmailFrom: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errEmailFrom = e;
    }
    check(
      errEmailFrom !== null && errEmailFrom.message.includes("EMAIL_FROM"),
      "1.4 Missing EMAIL_FROM in production fails startup",
      errEmailFrom?.message
    );

    // 1.5 Missing SMTP credentials when EMAIL_PROVIDER=smtp fails startup independently
    setValidBaseProductionEnv();
    process.env.EMAIL_PROVIDER = "smtp";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    let errSmtp: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errSmtp = e;
    }
    check(
      errSmtp !== null &&
        errSmtp.message.includes("SMTP_HOST") &&
        errSmtp.message.includes("SMTP_USER") &&
        errSmtp.message.includes("SMTP_PASS"),
      "1.5 Missing SMTP_HOST, SMTP_USER, and SMTP_PASS when EMAIL_PROVIDER=smtp all fail startup independently",
      errSmtp?.message
    );

    // 1.6 BREVO_API_KEY must never substitute for SMTP_PASS when EMAIL_PROVIDER=smtp
    setValidBaseProductionEnv();
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "smtp_user";
    delete process.env.SMTP_PASS;
    process.env.BREVO_API_KEY = "xkeysib-some-brevo-key";
    let errBrevoSub: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errBrevoSub = e;
    }
    check(
      errBrevoSub !== null && errBrevoSub.message.includes("SMTP_PASS"),
      "1.6 BREVO_API_KEY cannot substitute for SMTP_PASS when EMAIL_PROVIDER=smtp",
      errBrevoSub?.message
    );

    // 1.7 EMAIL_PROVIDER=gmail is rejected in production
    setValidBaseProductionEnv();
    process.env.EMAIL_PROVIDER = "gmail";
    let errGmail: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errGmail = e;
    }
    check(
      errGmail !== null && errGmail.message.includes("unsupported in production"),
      "1.7 EMAIL_PROVIDER=gmail is rejected from production allowlist",
      errGmail?.message
    );
    console.log("\n[GROUP 2: Production Image Storage Provider Validation]");

    // 2.1 Unset IMAGE_PROVIDER fails startup
    setValidBaseProductionEnv();
    delete process.env.IMAGE_PROVIDER;
    let errUnsetImage: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errUnsetImage = e;
    }
    check(
      errUnsetImage !== null && errUnsetImage.message.includes("IMAGE_PROVIDER"),
      "2.1 Unset IMAGE_PROVIDER in production causes fatal boot error",
      errUnsetImage?.message
    );

    // 2.2 IMAGE_PROVIDER=local fails startup
    setValidBaseProductionEnv();
    process.env.IMAGE_PROVIDER = "local";
    let errLocalImage: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errLocalImage = e;
    }
    check(
      errLocalImage !== null && errLocalImage.message.includes("IMAGE_PROVIDER"),
      "2.2 IMAGE_PROVIDER=local in production causes fatal boot error (ephemeral disk forbidden)",
      errLocalImage?.message
    );

    // 2.3 Missing Cloudinary credentials fails startup
    setValidBaseProductionEnv();
    process.env.IMAGE_PROVIDER = "cloudinary";
    delete process.env.CLOUDINARY_API_KEY;
    let errCloudinary: Error | null = null;
    try {
      validateProductionEnv();
    } catch (e) {
      if (e instanceof Error) errCloudinary = e;
    }
    check(
      errCloudinary !== null && errCloudinary.message.includes("CLOUDINARY_API_KEY"),
      "2.3 Missing CLOUDINARY_API_KEY when IMAGE_PROVIDER=cloudinary fails startup",
      errCloudinary?.message
    );

    console.log("\n[GROUP 3: Valid Production Configuration]");

    // 3.1 Fully valid production env passes without error
    setValidBaseProductionEnv();
    let validPass = true;
    try {
      validateProductionEnv();
    } catch (e) {
      validPass = false;
      console.error("Unexpected failure with valid prod env:", e);
    }
    check(validPass, "3.1 Fully configured production env passes validateProductionEnv() cleanly");

    console.log("\n[GROUP 4: ConsoleEmailProvider Production Defense]");

    // 4.1 ConsoleEmailProvider throws fatal error if called in production
    process.env.NODE_ENV = "production";
    const consoleProvider = new ConsoleEmailProvider();
    let consoleThrew = false;
    try {
      await consoleProvider.sendEmail({
        to: "victim@example.com",
        subject: "Verification",
        html: "<p>OTP: 123456</p>",
        text: "OTP: 123456",
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("FATAL SECURITY VIOLATION")) {
        consoleThrew = true;
      }
    }
    check(consoleThrew, "4.1 ConsoleEmailProvider throws fatal error if sendEmail() is invoked in production");

    // 4.2 getEmailProvider returns DisabledEmailProvider in production when misconfigured
    process.env.NODE_ENV = "production";
    process.env.EMAIL_PROVIDER = "console";
    const resolvedProvider = getEmailProvider();
    check(
      resolvedProvider.name === "none",
      "4.2 getEmailProvider() never returns ConsoleEmailProvider in production (returns DisabledEmailProvider)",
      `name=${resolvedProvider.name}`
    );

    console.log("\n[GROUP 5: Notification Service Dispatch Verification]");
    // 5.1 Test notificationService dispatching registration OTP, verification, password reset, order confirmed
    process.env.NODE_ENV = "test";
    await connectSafeTestDb();
    const dummyUserObjId = new mongoose.Types.ObjectId();
    const dummyOrderObjId = new mongoose.Types.ObjectId();

    const verifRes = await notificationService.notify({
      eventType: "EMAIL_VERIFICATION",
      entityType: "USER",
      entityId: dummyUserObjId,
      recipientEmail: "test@samratfashion.com",
      idempotencyKey: `TEST_EMAIL_VERIF_${Date.now()}`,
      data: { email: "test@samratfashion.com", otp: "654321", name: "Tester" },
    });
    check(
      verifRes.success === true && verifRes.status === "SENT",
      "5.1 Registration OTP & verification notification dispatched successfully with SENT status"
    );

    const pwdRes = await notificationService.notify({
      eventType: "PASSWORD_RESET_REQUESTED",
      entityType: "USER",
      entityId: dummyUserObjId,
      recipientEmail: "test@samratfashion.com",
      idempotencyKey: `TEST_PWD_RESET_${Date.now()}`,
      data: { email: "test@samratfashion.com", resetToken: "tok_test_abc123" },
    });
    check(
      pwdRes.success === true && pwdRes.status === "SENT",
      "5.2 Password reset notification dispatched successfully with SENT status"
    );

    const orderRes = await notificationService.notify({
      eventType: "ORDER_CONFIRMED",
      entityType: "ORDER",
      entityId: dummyOrderObjId,
      recipientEmail: "test@samratfashion.com",
      idempotencyKey: `TEST_ORDER_CONF_${Date.now()}`,
      data: {
        customerName: "Tester",
        orderNumber: "SF-2026-111222",
        total: 1499,
        amount: 1499,
        paymentId: "pay_live_test_123",
        items: [{ productName: "Heavyweight Tee", selectedSize: "L", selectedColor: "Black", quantity: 1, unitPrice: 1499 }],
        shippingAddress: {
          fullName: "Tester",
          addressLine1: "123 Test Street",
          city: "Bengaluru",
          state: "Karnataka",
          postalCode: "560001",
        },
      },
    });
    check(
      orderRes.success === true && orderRes.status === "SENT",
      "5.3 Order confirmation notification dispatched successfully with full valid payload and SENT status"
    );

    // 5.4 Invalid recipient email fails with SKIPPED status and error
    const invalidEmailRes = await notificationService.notify({
      eventType: "ORDER_CONFIRMED",
      entityType: "ORDER",
      entityId: dummyOrderObjId,
      recipientEmail: "not-an-email",
      idempotencyKey: `TEST_INVALID_EMAIL_${Date.now()}`,
      data: {},
    });
    check(
      invalidEmailRes.success === false && invalidEmailRes.status === "SKIPPED",
      "5.4 Invalid recipient email returns success: false with SKIPPED status"
    );

    console.log("\n[GROUP 6: MongoDB Transaction Support Preflight Verification]");

    // 6.1 Standalone MongoDB is rejected
    const standaloneRes = await verifyDatabaseTransactionSupport(mongoose.connection);
    check(
      standaloneRes.supported === false && standaloneRes.topology === "standalone",
      "6.1 Standalone MongoDB is strictly rejected by verifyDatabaseTransactionSupport",
      `supported=${standaloneRes.supported}, topology=${standaloneRes.topology}`
    );
    check(
      typeof standaloneRes.error === "string" && standaloneRes.error.includes("standalone"),
      "6.2 Standalone rejection provides explicit error requiring Replica Set or sharded cluster",
      standaloneRes.error
    );

    // 6.3 Replica set passes preflight and executes real harmless operation inside transaction
    let txStarted = false;
    let opExecuted = false;
    let txAborted = false;
    let sessionEnded = false;

    const mockReplicaConn = {
      readyState: 1,
      db: {
        command: async (cmd: Record<string, unknown>) => {
          if (cmd.hello || cmd.isMaster) {
            return { setName: "rs_production_primary", isWritablePrimary: true };
          }
          return {};
        },
        admin: () => ({
          command: async () => ({ setName: "rs_production_primary" }),
        }),
        collection: (name: string) => ({
          findOne: async (_filter: unknown, opts?: { session?: unknown }) => {
            if (name === "__tx_preflight_probe__" && opts?.session && txStarted && !txAborted) {
              opExecuted = true;
            }
            return null;
          },
        }),
      },
      startSession: async () => ({
        startTransaction: () => {
          txStarted = true;
        },
        abortTransaction: async () => {
          if (!opExecuted) {
            throw new Error("Preflight aborted without executing real in-transaction operation");
          }
          txAborted = true;
        },
        endSession: async () => {
          sessionEnded = true;
        },
      }),
    } as unknown as mongoose.Connection;

    const replicaRes = await verifyDatabaseTransactionSupport(mockReplicaConn);
    check(
      replicaRes.supported === true &&
        replicaRes.topology === "replica_set" &&
        replicaRes.setName === "rs_production_primary",
      "6.3 Replica set or Atlas database passes verifyDatabaseTransactionSupport",
      `supported=${replicaRes.supported}, setName=${replicaRes.setName}`
    );
    check(
      txStarted && opExecuted && txAborted && sessionEnded,
      "6.4 Preflight executes real harmless findOne operation inside transaction before aborting and ending session"
    );

    await mongoose.disconnect();
  } finally {
    restoreEnv(origEnv);
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runProductionEnvValidationSuite().catch((err) => {
  console.error("Production env validation test fatal error:", err);
  process.exit(1);
});
