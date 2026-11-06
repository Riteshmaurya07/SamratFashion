import assert from "node:assert/strict";
import test from "node:test";
import { getEmailProvider } from "../services/notifications/emailProviders";

test("Brevo SMTP key requires the Brevo SMTP login, not the sender email", async () => {
  const originalEnv = {
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    ALLOW_EMAIL_MOCK: process.env.ALLOW_EMAIL_MOCK,
    BREVO_API_KEY: process.env.BREVO_API_KEY,
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    SMTP_USER: process.env.SMTP_USER,
  };

  try {
    process.env.EMAIL_PROVIDER = "brevo";
    process.env.ALLOW_EMAIL_MOCK = "true";
    process.env.BREVO_API_KEY = "xsmtpsib-test-key";
    delete process.env.EMAIL_API_KEY;
    process.env.EMAIL_FROM = "sender@example.com";
    delete process.env.SMTP_USER;

    const missingLoginProvider = getEmailProvider();
    assert.equal(missingLoginProvider.name, "none");
    const missingLoginResult = await missingLoginProvider.sendEmail({
      to: "customer@example.com",
      subject: "Reset password",
      html: "<p>Reset password</p>",
      text: "Reset password",
    });
    assert.equal(missingLoginResult.success, false);
    assert.match(missingLoginResult.error || "", /SMTP_USER.*Brevo SMTP login/);

    process.env.SMTP_USER = "smtp-login@example.com";
    assert.equal(getEmailProvider().name, "smtp");
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
