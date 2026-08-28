import mongoose from 'mongoose';
import { NotificationLog, NotificationChannel } from '../../models/NotificationLog';
import { getEmailProvider, SendEmailOptions } from './emailProviders';
import {
  getOrderConfirmationTemplate,
  getPaymentSuccessTemplate,
  getPaymentFailedTemplate,
  getOrderShippedTemplate,
  getOrderDeliveredTemplate,
  getOrderCancelledTemplate,
  getRefundProcessedTemplate,
  getReturnStatusTemplate,
  getPasswordResetTemplate
} from './templates/emailTemplates';

export interface DispatchNotificationOptions {
  eventType: string;
  entityType: string;
  entityId: string | mongoose.Types.ObjectId;
  recipientEmail: string;
  recipientPhone?: string;
  channel?: NotificationChannel;
  idempotencyKey?: string;
  data: Record<string, any>;
}

export class NotificationService {
  /**
   * Asynchronously dispatches a notification.
   * Fail-Safe: Will NEVER throw an unhandled exception to the caller.
   */
  async notify(options: DispatchNotificationOptions): Promise<void> {
    const {
      eventType,
      entityType,
      entityId,
      recipientEmail,
      recipientPhone,
      channel = 'EMAIL',
      data
    } = options;

    if (!recipientEmail || !recipientEmail.includes('@')) {
      console.warn(`[NotificationService] Invalid email address: ${recipientEmail}. Notification skipped.`);
      return;
    }

    const idempotencyKey =
      options.idempotencyKey || `${eventType}:${entityType}:${entityId.toString()}:${recipientEmail}`;

    try {
      // 1. Notification Idempotency Check
      const existingLog = await NotificationLog.findOne({ idempotencyKey });
      if (existingLog && existingLog.status === 'SENT') {
        console.log(`[NotificationService] Duplicate event skipped via idempotencyKey (${idempotencyKey})`);
        return;
      }

      // 2. Build Email Options from Template
      const templateResult = this.buildTemplate(eventType, data);
      if (!templateResult) {
        console.warn(`[NotificationService] No email template mapped for eventType: ${eventType}`);
        return;
      }

      const emailOptions: SendEmailOptions = {
        to: recipientEmail,
        subject: templateResult.subject,
        html: templateResult.html,
        text: templateResult.text
      };

      // 3. Provider Selection & Dispatch
      const provider = getEmailProvider();
      const result = await provider.sendEmail(emailOptions);

      const status = result.success
        ? 'SENT'
        : result.error === 'EMAIL PROVIDER NOT CONFIGURED'
        ? 'NOT_CONFIGURED'
        : 'FAILED';

      // 4. Record Notification Log
      await NotificationLog.findOneAndUpdate(
        { idempotencyKey },
        {
          eventType,
          entityType,
          entityId: new mongoose.Types.ObjectId(entityId.toString()),
          recipientEmail,
          recipientPhone,
          channel,
          status,
          provider: result.provider,
          providerMessageId: result.messageId,
          sentAt: result.success ? new Date() : undefined,
          lastError: result.error,
          idempotencyKey,
          $inc: { attemptCount: 1 }
        },
        { upsert: true, new: true }
      );

      console.log(`[NotificationService] Notification dispatched: ${eventType} -> ${recipientEmail} [Status: ${status}]`);
    } catch (err: any) {
      // CRITICAL OBSERVER RULE: Catch all errors silently to protect business transactions
      console.error(`[NotificationService Exception] Error sending notification for ${eventType}:`, err.message || err);
      
      try {
        await NotificationLog.findOneAndUpdate(
          { idempotencyKey },
          {
            eventType,
            entityType,
            entityId: new mongoose.Types.ObjectId(entityId.toString()),
            recipientEmail,
            recipientPhone,
            channel,
            status: 'FAILED',
            provider: 'unknown',
            lastError: err.message || 'Unknown exception',
            idempotencyKey,
            $inc: { attemptCount: 1 }
          },
          { upsert: true, new: true }
        );
      } catch (logErr) {
        console.error('[NotificationService Exception] Failed to record error log:', logErr);
      }
    }
  }

  private buildTemplate(eventType: string, data: any): { subject: string; html: string; text: string } | null {
    switch (eventType) {
      case 'ORDER_CONFIRMED':
      case 'ORDER_CREATED':
        return getOrderConfirmationTemplate(data as any);
      case 'PAYMENT_SUCCESS':
        return getPaymentSuccessTemplate(data as any);
      case 'PAYMENT_FAILED':
        return getPaymentFailedTemplate(data as any);
      case 'ORDER_SHIPPED':
        return getOrderShippedTemplate(data as any);
      case 'ORDER_DELIVERED':
        return getOrderDeliveredTemplate(data as any);
      case 'ORDER_CANCELLED':
        return getOrderCancelledTemplate(data as any);
      case 'REFUND_PROCESSED':
        return getRefundProcessedTemplate(data as any);
      case 'RETURN_STATUS_UPDATED':
      case 'RETURN_APPROVED':
      case 'RETURN_REJECTED':
        return getReturnStatusTemplate(data as any);
      case 'PASSWORD_RESET_REQUESTED':
        return getPasswordResetTemplate(data as any);
      default:
        return null;
    }
  }
}

export const notificationService = new NotificationService();
