import Razorpay from 'razorpay';
import crypto from 'crypto';
import { AppError } from '../../utils/AppError';
export interface RazorpayOrderResult {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt?: string;
  status: string;
  attempts: number;
  notes?: Record<string, string | number>;
  created_at: number;
}

export interface RazorpayRefundResult {
  id: string;
  entity: string;
  amount: number;
  status: string;
  notes?: Record<string, string | number>;
}

class RazorpayProvider {
  private razorpay?: InstanceType<typeof Razorpay>;
  private currentKeyId?: string;
  private currentKeySecret?: string;

  constructor() {
    this.getClient();
  }
  public getClient(): InstanceType<typeof Razorpay> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (
      this.razorpay &&
      this.currentKeyId === keyId &&
      this.currentKeySecret === keySecret
    ) {
      return this.razorpay;
    }

    this.currentKeyId = keyId;
    this.currentKeySecret = keySecret;

    console.log(
      `[RAZORPAY INIT] Key ID loaded: ${Boolean(keyId)} (${keyId ? keyId.substring(0, 8) + '...' : 'none'}), Key Secret loaded: ${Boolean(keySecret)}`
    );

    this.razorpay = new Razorpay({
      key_id: keyId || 'dummy_key',
      key_secret: keySecret || 'dummy_secret',
    });

    return this.razorpay;
  }

  async createOrder(
    amountInPaise: number,
    receipt: string,
    notes: Record<string, string | number> = {}
  ): Promise<RazorpayOrderResult> {
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
      // Cast across razorpay SDK callback-overload union to domain result
      const created = (await this.getClient().orders.create(options)) as unknown as RazorpayOrderResult;
      return created;
    } catch (err: unknown) {
      const errObj = (err && typeof err === 'object') ? (err as Record<string, unknown>) : {};
      const nestedError = (errObj.error && typeof errObj.error === 'object') ? (errObj.error as Record<string, unknown>) : undefined;
      const errorMsg = (typeof nestedError?.description === 'string' && nestedError.description) ||
        (typeof errObj.message === 'string' && errObj.message) ||
        'Razorpay API error';
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

  async createRefund(
    razorpayPaymentId: string,
    amountInPaise: number,
    notes: Record<string, string | number> = {}
  ): Promise<RazorpayRefundResult> {
    if (razorpayPaymentId.startsWith('pay_mock_') || razorpayPaymentId.startsWith('order_mock_')) {
      console.warn('[PAYMENT MOCK] Mock refund processed successfully');
      return { id: `rfnd_mock_${Date.now()}`, entity: 'refund', amount: amountInPaise, status: 'processed' };
    }
    // Cast across razorpay SDK callback-overload union to domain result
    const refundResult = (await this.getClient().payments.refund(razorpayPaymentId, {
      amount: amountInPaise,
      notes,
    })) as unknown as RazorpayRefundResult;
    return refundResult;
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
