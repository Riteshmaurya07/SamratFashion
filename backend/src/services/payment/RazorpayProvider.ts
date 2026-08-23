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
    return this.razorpay.orders.create(options);
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
