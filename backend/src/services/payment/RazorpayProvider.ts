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
    if (process.env.NODE_ENV === 'test' || (typeof process.env.npm_lifecycle_event === 'string' && process.env.npm_lifecycle_event.startsWith('test'))) {
      if (this.razorpay && this.currentKeyId === 'rzp_test_mock') {
        return this.razorpay;
      }
      this.currentKeyId = 'rzp_test_mock';
      this.currentKeySecret = 'mock_secret_test';
      const blockedFn = async () => {
        throw new AppError('[TEST HARNESS FAIL CLOSED] Real Razorpay API transport blocked in test environment', 500);
      };
      this.razorpay = {
        api: {
          rq: {
            defaults: {
              auth: {
                username: 'rzp_test_mock',
                password: 'mock_secret_test'
              }
            },
            post: blockedFn
          }
        },
        orders: { create: blockedFn, fetch: blockedFn },
        payments: { fetch: blockedFn, refund: blockedFn },
        refunds: { fetch: blockedFn }
      } as unknown as InstanceType<typeof Razorpay>;
      return this.razorpay;
    }
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

    console.log(`[RAZORPAY INIT] Provider client initialized. Configured: ${Boolean(keyId && keySecret)}`);
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
    notes: Record<string, string | number> = {},
    idempotencyKey?: string
  ): Promise<RazorpayRefundResult> {
    if (idempotencyKey) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > 40 || !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
        throw new AppError('Invalid idempotency key format: must be alphanumeric/hyphens/underscores up to 40 characters', 400);
      }
    }

    const isMock = razorpayPaymentId.startsWith('pay_mock_') || razorpayPaymentId.startsWith('order_mock_');
    if (isMock) {
      if (!isMockPaymentPermitted()) {
        throw new AppError('Mock refunds are not allowed in production or staging environments.', 403, 'FORBIDDEN');
      }
      console.warn('[PAYMENT MOCK] Mock refund processed successfully');
      return { id: `rfnd_mock_${Date.now()}`, entity: 'refund', amount: amountInPaise, status: 'processed', notes };
    }

    const client = this.getClient() as unknown as {
      api?: {
        rq?: {
          post: (url: string, data: unknown, config?: { headers?: Record<string, string> }) => Promise<{ data: RazorpayRefundResult }>;
        };
      };
      payments: {
        refund: (paymentId: string, data: unknown) => Promise<RazorpayRefundResult>;
      };
    };

    // If idempotencyKey is provided and direct Axios request client is available,
    // pass the documented X-Refund-Idempotency header directly to the payments/{id}/refund endpoint.
    if (idempotencyKey && client.api?.rq?.post) {
      try {
        const res = await client.api.rq.post(
          `/v1/payments/${razorpayPaymentId}/refund`,
          { amount: amountInPaise, notes },
          { headers: { 'X-Refund-Idempotency': idempotencyKey } }
        );
        return res.data;
      } catch (httpErr: unknown) {
        if (httpErr && typeof httpErr === 'object' && 'response' in httpErr) {
          const respObj = httpErr.response;
          if (respObj && typeof respObj === 'object') {
            const statusVal = 'status' in respObj && typeof respObj.status === 'number' ? respObj.status : undefined;
            const dataVal = 'data' in respObj && respObj.data && typeof respObj.data === 'object' ? respObj.data : undefined;
            const errorVal = dataVal && 'error' in dataVal ? dataVal.error : dataVal;
            throw {
              statusCode: statusVal,
              error: errorVal
            };
          }
        }
        throw httpErr;
      }
    }

    if (idempotencyKey) {
      // Idempotency was requested but transport client cannot transmit header: fail closed!
      throw new AppError('Razorpay transport cannot transmit required idempotency header: failing closed', 500, 'IDEMPOTENCY_NOT_SUPPORTED');
    }

    // Standard fallback across Razorpay SDK payments resource (for callers without idempotency key)
    const refundResult = await client.payments.refund(razorpayPaymentId, {
      amount: amountInPaise,
      notes,
    });
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
