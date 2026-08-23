export interface IEmailService {
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
}

class DevelopmentEmailAdapter implements IEmailService {
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    console.log("\n=========================================");
    console.log("🛠️ DEVELOPMENT ONLY - MOCK EMAIL SENT");
    console.log(`To: ${email}`);
    console.log(`Subject: Password Reset Request`);
    console.log(`Reset URL: ${resetUrl}`);
    console.log("=========================================\n");
  }
}

// In the future, you could have a ResendAdapter or SESAdapter implementing IEmailService.
// For now, we return the development adapter.
export const emailService: IEmailService = new DevelopmentEmailAdapter();
