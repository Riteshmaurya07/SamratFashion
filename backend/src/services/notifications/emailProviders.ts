import { BrevoClient } from '@getbrevo/brevo';

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
    console.log('\n=========================================');
    console.log('🛠️ DEVELOPMENT ONLY - MOCK EMAIL SENT');
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Text Preview: ${options.text.substring(0, 150)}...`);
    console.log('=========================================\n');

    return {
      success: true,
      messageId: `console-msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      provider: 'console'
    };
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

  if (providerType === 'brevo') {
    const brevoApiKey = process.env.BREVO_API_KEY || process.env.EMAIL_API_KEY;
    if (brevoApiKey) {
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

  if (process.env.NODE_ENV === 'production' && providerType !== 'console') {
    return new DisabledEmailProvider('Invalid email provider configuration');
  }

  // Default to console provider for local development/testing
  return new ConsoleEmailProvider();
};
