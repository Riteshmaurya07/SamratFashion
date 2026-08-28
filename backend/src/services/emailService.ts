import { notificationService } from './notifications/notificationService';

export interface IEmailService {
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
}

class NotificationEmailAdapter implements IEmailService {
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    await notificationService.notify({
      eventType: 'PASSWORD_RESET_REQUESTED',
      entityType: 'USER',
      entityId: 'reset-token-' + Date.now(),
      recipientEmail: email,
      idempotencyKey: `PASSWORD_RESET:${email}:${token}`,
      data: { email, resetToken: token }
    });
  }
}

export const emailService: IEmailService = new NotificationEmailAdapter();
