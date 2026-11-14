import { BrevoClient } from '@getbrevo/brevo';
import nodemailer, { Transporter } from 'nodemailer';
export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export interface IEmailProvider {
  name: string;
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
}

// 1. Development Console Provider (Explicitly Dev Only)
export class ConsoleEmailProvider implements IEmailProvider {
  name = 'console';

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const isStrict = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    if (isStrict) {
      throw new Error('FATAL SECURITY VIOLATION: ConsoleEmailProvider cannot be used in production or staging environments.');
    }
    console.log('\n=========================================');
    console.log('🛠️ [EMAIL SERVICE] MOCK/CONSOLE EMAIL SENT');
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Text Body:\n${options.text}`);
    console.log('=========================================\n');

    return {
      success: true,
      messageId: `console-msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      provider: 'console'
    };
  }
}

// 2. SMTP Provider (Nodemailer - supports Gmail, Brevo SMTP, custom SMTP)
export class NodemailerEmailProvider implements IEmailProvider {
  name = 'smtp';
  private transporter: Transporter;
  private senderEmail: string;
  private senderName: string;

  constructor(config: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    service?: string;
    senderEmail?: string;
    senderName?: string;
  }) {
    this.senderEmail = config.senderEmail || process.env.EMAIL_FROM || 'no-reply@samratfashion.com';
    this.senderName = config.senderName || process.env.EMAIL_FROM_NAME || 'Samrat Fashion';

    if (config.service) {
      this.transporter = nodemailer.createTransport({
        service: config.service,
        auth: {
          user: config.user || process.env.SMTP_USER || process.env.GMAIL_USER || this.senderEmail,
          pass: config.pass || process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD,
        },
      });
    } else {
      const port = config.port || Number(process.env.SMTP_PORT) || 587;
      this.transporter = nodemailer.createTransport({
        host: config.host || process.env.SMTP_HOST || 'smtp-relay.brevo.com',
        port,
        secure: config.secure ?? (port === 465),
        auth: {
          user: config.user || process.env.SMTP_USER || this.senderEmail,
          pass: config.pass || process.env.SMTP_PASS,
        },
      });
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const info = await this.transporter.sendMail({
        from: `"${this.senderName}" <${this.senderEmail}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      return {
        success: true,
        messageId: info.messageId || `smtp-${Date.now()}`,
        provider: 'smtp',
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err || 'SMTP sending failed');
      return {
        success: false,
        provider: 'smtp',
        error: errorMsg,
      };
    }
  }
}

// 2. Real Brevo Transactional Email Provider (Using Official @getbrevo/brevo SDK)
export class BrevoEmailProvider implements IEmailProvider {
  name = 'brevo';
  private client: BrevoClient;
  private senderEmail: string;
  private senderName: string;

  constructor(apiKey: string, senderEmail?: string, senderName?: string) {
    this.client = new BrevoClient({ apiKey });
    this.senderEmail = senderEmail || process.env.EMAIL_FROM || 'no-reply@samratfashion.com';
    this.senderName = senderName || process.env.EMAIL_FROM_NAME || 'Samrat Fashion';
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const response = await this.client.transactionalEmails.sendTransacEmail({
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: options.to }],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text
      });

      const messageId = (response as any)?.messageId || (response as any)?.messageIds?.[0] || `brevo-${Date.now()}`;

      return {
        success: true,
        messageId,
        provider: 'brevo'
      };
    } catch (err: any) {
      const errorMessage = err?.body?.message || err?.message || 'Brevo API request failed';
      return {
        success: false,
        provider: 'brevo',
        error: errorMessage
      };
    }
  }
}

// 3. Resend API Provider
export class ResendEmailProvider implements IEmailProvider {
  name = 'resend';
  private apiKey: string;
  private fromEmail: string;

  constructor(apiKey: string, fromEmail?: string) {
    this.apiKey = apiKey;
    this.fromEmail = fromEmail || process.env.EMAIL_FROM || 'Samrat Fashion <no-reply@samratfashion.com>';
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          provider: 'resend',
          error: data.message || `Resend API returned status ${response.status}`
        };
      }

      return {
        success: true,
        messageId: data.id || `resend-${Date.now()}`,
        provider: 'resend'
      };
    } catch (err: any) {
      return {
        success: false,
        provider: 'resend',
        error: err.message || 'Resend HTTP request failed'
      };
    }
  }
}

// 4. Disabled / Unconfigured Provider (Fail-safe for Production when credentials missing)
export class DisabledEmailProvider implements IEmailProvider {
  name = 'none';
  private reason: string;

  constructor(reason = 'EMAIL PROVIDER NOT CONFIGURED') {
    this.reason = reason;
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    return {
      success: false,
      provider: 'none',
      error: this.reason
    };
  }
}

// Provider Factory
export const getEmailProvider = (): IEmailProvider => {
  const providerType = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();

  if (providerType === 'smtp') {
    const isStrict = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (isStrict && (!host || !user || !pass)) {
      return new DisabledEmailProvider('SMTP requires SMTP_HOST, SMTP_USER, and SMTP_PASS independently in production');
    }
    return new NodemailerEmailProvider({
      host,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
      secure: process.env.SMTP_SECURE === 'true',
      user,
      pass,
      senderEmail: process.env.EMAIL_FROM,
      senderName: process.env.EMAIL_FROM_NAME,
    });
  }

  if (providerType === 'gmail') {
    const isStrict = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
    if (isStrict) {
      return new DisabledEmailProvider('Gmail is not supported in production or staging environments (must be brevo, smtp, or resend)');
    }
    return new NodemailerEmailProvider({
      service: 'gmail',
      user: process.env.GMAIL_USER || process.env.SMTP_USER,
      pass: process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS,
      senderEmail: process.env.EMAIL_FROM,
      senderName: process.env.EMAIL_FROM_NAME,
    });
  }
  if (providerType === 'brevo') {
    const brevoApiKey = process.env.BREVO_API_KEY || process.env.EMAIL_API_KEY;
    if (brevoApiKey) {
      // If key starts with xsmtpsib-, it's an SMTP key for Brevo SMTP relay
      if (brevoApiKey.startsWith('xsmtpsib-')) {
        const smtpUser = process.env.SMTP_USER?.trim();
        if (!smtpUser) {
          return new DisabledEmailProvider('SMTP_USER must be set to the Brevo SMTP login when using a Brevo SMTP key');
        }

        return new NodemailerEmailProvider({
          host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
          port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
          user: smtpUser,
          pass: brevoApiKey,
          senderEmail: process.env.EMAIL_FROM,
          senderName: process.env.EMAIL_FROM_NAME,
        });
      }
      return new BrevoEmailProvider(brevoApiKey, process.env.EMAIL_FROM, process.env.EMAIL_FROM_NAME);
    }
    
    // Strict production/staging check: do NOT silently fallback to console provider
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
      return new DisabledEmailProvider('BREVO_API_KEY is missing in environment');
    }
    
    if (process.env.ALLOW_EMAIL_MOCK === 'true') {
      return new ConsoleEmailProvider();
    }

    return new DisabledEmailProvider('BREVO_API_KEY is missing');
  }

  if (providerType === 'resend') {
    const resendApiKey = process.env.EMAIL_API_KEY;
    if (resendApiKey) {
      return new ResendEmailProvider(resendApiKey);
    }
    return new DisabledEmailProvider('Resend API key missing');
  }

  const isStrict = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
  if (isStrict) {
    return new DisabledEmailProvider('Production requires an explicitly configured email provider (brevo, smtp, or resend)');
  }

  // Default to console provider for local development/testing only
  return new ConsoleEmailProvider();
};
