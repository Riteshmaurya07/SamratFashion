import Razorpay from 'razorpay';
import crypto from 'crypto';

class RazorpayProvider {
  private razorpay: any;

  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
    });
  }

  async createOrder(amountInPaise: number, receipt: string, notes: any = {}) {
    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes,
    };
    try {
      return await this.razorpay.orders.create(options);
    } catch (err: any) {
      // If Razorpay API rejects dummy/invalid test keys in local dev, provide mock order payload
      if (process.env.NODE_ENV !== 'production') {
        console.warn("[PAYMENT MOCK] Real Razorpay API call failed (invalid key credentials). Generating mock order ID for testing.");
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
      throw err;
    }
  }

  async createRefund(razorpayPaymentId: string, amountInPaise: number, notes: any = {}) {
    return this.razorpay.payments.refund(razorpayPaymentId, {
      amount: amountInPaise,
      notes,
    });
  }

  verifyPaymentSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_KEY_SECRET || 'dummy_secret';
    const body = razorpayOrderId + '|' + razorpayPaymentId;
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body.toString())
      .digest('hex');
      
    return expectedSignature === signature;
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || 'dummy_webhook_secret';
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
      
    return expectedSignature === signature;
  }
}

export const razorpayProvider = new RazorpayProvider();
