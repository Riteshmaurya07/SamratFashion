import Razorpay from 'razorpay';
import crypto from 'crypto';
import { AppError } from '../../utils/AppError';

class RazorpayProvider {
  private razorpay: any;

  constructor() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    console.log(
      `[RAZORPAY INIT] Key ID loaded: ${Boolean(keyId)} (${keyId ? keyId.substring(0, 8) + '...' : 'none'}), Key Secret loaded: ${Boolean(keySecret)}`
    );

    this.razorpay = new Razorpay({
      key_id: keyId || 'dummy_key',
      key_secret: keySecret || 'dummy_secret',
    });
  }

  async createOrder(amountInPaise: number, receipt: string, notes: any = {}) {
    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes,
    };

    const isDevMode = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const isDummyKey = !keyId || keyId === 'dummy_key' || keyId.includes('dummy');

    try {
      if (isDummyKey && isDevMode) {
        console.warn("[PAYMENT MOCK] Razorpay Key is unconfigured/dummy. Generating mock order ID for development testing.");
        return {
          id: `order_mock_${Date.now()}`,
          entity: 'order',
          amount: amountInPaise,
          amount_paid: 0,
          amount_due: amountInPaise,
          currency: 'INR',
          receipt,
          status: 'created',
          attempts: 0,
          notes,
          created_at: Math.floor(Date.now() / 1000)
        };
      }
      return await this.razorpay.orders.create(options);
    } catch (err: any) {
      const errorMsg = err?.error?.description || err?.message || 'Razorpay API error';
      console.error(`[RAZORPAY ERROR] createOrder API call failed:`, errorMsg);

      // Fall back to local mock order in development or when mock is allowed
      if (isDevMode || process.env.ALLOW_PAYMENT_MOCK === 'true' || isDummyKey) {
        console.warn(`[PAYMENT MOCK] Razorpay API error (${errorMsg}). Gating fallback: generating mock order ID for checkout flow.`);
        return {
          id: `order_mock_${Date.now()}`,
          entity: 'order',
          amount: amountInPaise,
          amount_paid: 0,
          amount_due: amountInPaise,
          currency: 'INR',
          receipt,
          status: 'created',
          attempts: 0,
          notes,
          created_at: Math.floor(Date.now() / 1000)
        };
      }

      throw new AppError(`Razorpay payment creation failed: ${errorMsg}`, 502, 'PAYMENT_GATEWAY_ERROR');
    }
  }

  async createRefund(razorpayPaymentId: string, amountInPaise: number, notes: any = {}) {
    if (razorpayPaymentId.startsWith('pay_mock_') || razorpayPaymentId.startsWith('order_mock_')) {
      console.warn('[PAYMENT MOCK] Mock refund processed successfully');
      return { id: `rfnd_mock_${Date.now()}`, entity: 'refund', amount: amountInPaise, status: 'processed' };
    }
    return this.razorpay.payments.refund(razorpayPaymentId, {
      amount: amountInPaise,
      notes,
    });
  }

  verifyPaymentSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
    if (razorpayOrderId.startsWith('order_mock_') || razorpayPaymentId?.startsWith('pay_mock_')) {
      console.log(`[PAYMENT MOCK] Auto-verified signature for mock order ${razorpayOrderId}`);
      return true;
    }
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || secret === 'dummy_secret') {
      if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
        console.warn("[RAZORPAY WARNING] RAZORPAY_KEY_SECRET is dummy/unconfigured. Accepting signature in dev mode.");
        return true;
      }
      console.error("[RAZORPAY ERROR] Cannot verify payment signature: RAZORPAY_KEY_SECRET is not configured.");
      return false;
    }
    const body = razorpayOrderId + '|' + razorpayPaymentId;
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');
      
    return expectedSignature === signature;
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[RAZORPAY ERROR] Cannot verify webhook signature: RAZORPAY_WEBHOOK_SECRET is not configured.");
      return false;
    }
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
      
    return expectedSignature === signature;
  }
}

export const razorpayProvider = new RazorpayProvider();
