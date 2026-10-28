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

export function isMockPaymentPermitted(): boolean {
  const env = (process.env.NODE_ENV || '').toLowerCase();
  const isStrictEnv = env === 'production' || env === 'staging';
  if (isStrictEnv) return false;
  return (env === 'development' || env === 'test' || !env) && process.env.ALLOW_PAYMENT_MOCK === 'true';
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

    const mockAllowed = isMockPaymentPermitted();
    const keyId = process.env.RAZORPAY_KEY_ID;
    const isDummyKey = !keyId || keyId === 'dummy_key' || keyId.includes('dummy');

    try {
      if (isDummyKey && mockAllowed) {
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

      // Only fall back to local mock order if mock is explicitly permitted (never in production/staging)
      if (mockAllowed) {
        console.warn(`[PAYMENT MOCK] Razorpay API error (${errorMsg}). Gating fallback: generating mock order ID for development checkout flow.`);
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
    const isMock = razorpayPaymentId.startsWith('pay_mock_') || razorpayPaymentId.startsWith('order_mock_');
    if (isMock) {
      if (!isMockPaymentPermitted()) {
        throw new AppError('Mock refunds are not allowed in production or staging environments.', 403, 'FORBIDDEN');
      }
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
    const mockAllowed = isMockPaymentPermitted();
    const isMockIdentifier = razorpayOrderId?.startsWith('order_mock_') || razorpayPaymentId?.startsWith('pay_mock_');

    if (isMockIdentifier) {
      if (!mockAllowed) {
        console.error('[RAZORPAY SECURITY ERROR] Mock payment identifiers rejected in non-mock environment.');
        return false;
      }
      return signature?.startsWith('sig_mock_') || signature === 'mock_signature_bypass';
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || secret === 'dummy_secret') {
      if (mockAllowed) {
        console.warn("[RAZORPAY WARNING] RAZORPAY_KEY_SECRET is dummy/unconfigured. Accepting signature in dev mock mode.");
        return signature?.startsWith('sig_mock_') || false;
      }
      console.error("[RAZORPAY ERROR] Cannot verify payment signature: RAZORPAY_KEY_SECRET is not configured.");
      return false;
    }

    if (!signature || typeof signature !== 'string' || !razorpayOrderId || !razorpayPaymentId) {
      return false;
    }

    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'utf8');
    const expBuffer = Buffer.from(expectedSignature, 'utf8');

    if (sigBuffer.length !== expBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expBuffer);
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[RAZORPAY ERROR] Cannot verify webhook signature: RAZORPAY_WEBHOOK_SECRET is not configured.");
      return false;
    }
    
    if (!signature || typeof signature !== 'string' || !rawBody) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'utf8');
    const expBuffer = Buffer.from(expectedSignature, 'utf8');

    if (sigBuffer.length !== expBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expBuffer);
  }
}

export const razorpayProvider = new RazorpayProvider();
