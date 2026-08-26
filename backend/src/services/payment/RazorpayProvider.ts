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

    const isDevMode = process.env.NODE_ENV === 'development';
    const isMockAllowed = isDevMode && process.env.ALLOW_PAYMENT_MOCK === 'true';

    try {
      return await this.razorpay.orders.create(options);
    } catch (err: any) {
      const errorMsg = err?.error?.description || err?.message || 'Razorpay API error';
      console.error(`[RAZORPAY ERROR] createOrder API call failed:`, errorMsg);

      // Explicitly local-development mock ONLY if gated by ALLOW_PAYMENT_MOCK=true in NODE_ENV=development
      if (isMockAllowed) {
        console.warn("[PAYMENT MOCK] Real Razorpay API call failed in dev mode with ALLOW_PAYMENT_MOCK=true. Generating mock order ID for testing.");
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
    return this.razorpay.payments.refund(razorpayPaymentId, {
      amount: amountInPaise,
      notes,
    });
  }

  verifyPaymentSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
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
