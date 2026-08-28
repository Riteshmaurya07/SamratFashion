// HTML Security Escaper to prevent raw text injection
export function escapeHtml(str: string | number | undefined | null): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function renderBrandedEmailHtml(title: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #0B0E14; color: #E2E8F0; }
    .wrapper { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
    .header { text-align: center; padding: 24px 0; border-bottom: 1px solid #1E293B; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #FFFFFF; text-decoration: none; text-transform: uppercase; }
    .brand span { color: #3B82F6; }
    .content { background-color: #161B22; border: 1px solid #1E293B; border-radius: 12px; padding: 28px 24px; margin: 24px 0; }
    .h1 { font-size: 20px; font-weight: 700; color: #FFFFFF; margin-top: 0; margin-bottom: 16px; }
    .p { font-size: 14px; line-height: 1.6; color: #94A3B8; margin-bottom: 16px; }
    .btn { display: inline-block; background-color: #003EA8; color: #FFFFFF; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin: 16px 0; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge-success { background-color: rgba(16, 185, 129, 0.15); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-info { background-color: rgba(59, 130, 246, 0.15); color: #3B82F6; border: 1px solid rgba(59, 130, 246, 0.3); }
    .table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .table th { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748B; border-bottom: 1px solid #1E293B; text-align: left; padding: 8px 4px; }
    .table td { font-size: 13px; color: #E2E8F0; border-bottom: 1px solid #1E293B; padding: 12px 4px; }
    .footer { text-align: center; font-size: 12px; color: #64748B; padding: 16px 0; border-top: 1px solid #1E293B; margin-top: 24px; }
    .footer a { color: #3B82F6; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <a href="${FRONTEND_URL}" class="brand">SAMRAT<span>FASHION</span></a>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>This is an automated transactional message regarding your Samrat Fashion account.</p>
      <p>© ${new Date().getFullYear()} Samrat Fashion Store. All rights reserved. | <a href="${FRONTEND_URL}/support">Customer Support</a></p>
    </div>
  </div>
</body>
</html>`;
}

// 1. Order Confirmation Template
export function getOrderConfirmationTemplate(data: {
  customerName: string;
  orderNumber: string;
  items: Array<{ productName: string; selectedSize: string; selectedColor: string; quantity: number; unitPrice: number }>;
  total: number;
  shippingAddress: { fullName: string; addressLine1: string; city: string; state: string; postalCode: string };
}) {
  const title = `Order Confirmed - #${data.orderNumber}`;
  
  const itemsHtml = data.items
    .map(
      i => `<tr>
        <td><strong>${escapeHtml(i.productName)}</strong><br><span style="color:#64748B;font-size:11px;">${escapeHtml(i.selectedSize)} / ${escapeHtml(i.selectedColor)}</span></td>
        <td>${i.quantity}</td>
        <td style="text-align:right;">₹${i.unitPrice * i.quantity}</td>
      </tr>`
    )
    .join('');

  const content = `
    <div class="h1">Thank You for Your Order!</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, your order <strong>#${escapeHtml(data.orderNumber)}</strong> has been confirmed and is being processed by our warehouse.</div>
    
    <table class="table">
      <thead>
        <tr><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div style="text-align:right;font-size:16px;font-weight:700;color:#FFFFFF;margin-top:16px;">
      Total Paid: ₹${data.total.toLocaleString()}
    </div>

    <div style="margin-top:24px;padding:16px;background:#0B0E14;border-radius:8px;">
      <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;">Shipping Address</div>
      <div style="font-size:13px;color:#E2E8F0;margin-top:4px;">
        ${escapeHtml(data.shippingAddress.fullName)}<br>
        ${escapeHtml(data.shippingAddress.addressLine1)}<br>
        ${escapeHtml(data.shippingAddress.city)}, ${escapeHtml(data.shippingAddress.state)} ${escapeHtml(data.shippingAddress.postalCode)}
      </div>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <a href="${FRONTEND_URL}/account/orders" class="btn">View Order Details</a>
    </div>
  `;

  const text = `Hi ${data.customerName}, your order #${data.orderNumber} for ₹${data.total} has been confirmed. View details at ${FRONTEND_URL}/account/orders`;

  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 2. Payment Success Template
export function getPaymentSuccessTemplate(data: { customerName: string; orderNumber: string; amount: number; paymentId: string }) {
  const title = `Payment Received - Order #${data.orderNumber}`;
  const content = `
    <div class="h1">Payment Received Successfully</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, we have received your payment of <strong>₹${data.amount.toLocaleString()}</strong> for Order <strong>#${escapeHtml(data.orderNumber)}</strong>.</div>
    <div class="p" style="font-size:12px;color:#64748B;">Transaction ID: ${escapeHtml(data.paymentId)}</div>
    <div style="text-align:center;margin-top:24px;">
      <a href="${FRONTEND_URL}/account/orders" class="btn">View Account</a>
    </div>
  `;
  const text = `Hi ${data.customerName}, payment of ₹${data.amount} for Order #${data.orderNumber} was received. Txn ID: ${data.paymentId}`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 3. Payment Failed Template
export function getPaymentFailedTemplate(data: { customerName: string; orderNumber: string; amount: number; errorReason?: string }) {
  const title = `Payment Action Required - Order #${data.orderNumber}`;
  const content = `
    <div class="h1" style="color:#EF4444;">Payment Could Not Be Completed</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, your payment of <strong>₹${data.amount.toLocaleString()}</strong> for Order <strong>#${escapeHtml(data.orderNumber)}</strong> could not be processed.</div>
    ${data.errorReason ? `<div class="p" style="color:#F87171;">Reason: ${escapeHtml(data.errorReason)}</div>` : ''}
    <div class="p">Don't worry! Your items are saved. Click below to complete your payment securely.</div>
    <div style="text-align:center;margin-top:24px;">
      <a href="${FRONTEND_URL}/checkout" class="btn" style="background-color:#DC2626;">Retry Payment</a>
    </div>
  `;
  const text = `Hi ${data.customerName}, payment of ₹${data.amount} for Order #${data.orderNumber} failed. Please retry at ${FRONTEND_URL}/checkout`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 4. Order Shipped Template
export function getOrderShippedTemplate(data: { customerName: string; orderNumber: string; carrier: string; trackingNumber: string; trackingUrl?: string }) {
  const title = `Your Parcel is Shipped! - #${data.orderNumber}`;
  const content = `
    <div class="h1">Your Package is On Its Way!</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, order <strong>#${escapeHtml(data.orderNumber)}</strong> has been handed over to our shipping partner <strong>${escapeHtml(data.carrier)}</strong>.</div>
    
    <div style="margin:20px 0;padding:16px;background:#0B0E14;border-radius:8px;">
      <div style="font-size:12px;color:#64748B;">Courier Partner: <strong>${escapeHtml(data.carrier)}</strong></div>
      <div style="font-size:14px;color:#3B82F6;font-weight:700;margin-top:4px;">AWB Tracking No: ${escapeHtml(data.trackingNumber)}</div>
    </div>

    ${data.trackingUrl ? `
    <div style="text-align:center;margin-top:24px;">
      <a href="${escapeHtml(data.trackingUrl)}" target="_blank" class="btn">Track Shipment Live</a>
    </div>` : ''}
  `;
  const text = `Hi ${data.customerName}, Order #${data.orderNumber} shipped via ${data.carrier} (AWB: ${data.trackingNumber}).`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 5. Order Delivered Template
export function getOrderDeliveredTemplate(data: { customerName: string; orderNumber: string }) {
  const title = `Delivered! - Order #${data.orderNumber}`;
  const content = `
    <div class="h1" style="color:#10B981;">Your Order Has Been Delivered!</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, order <strong>#${escapeHtml(data.orderNumber)}</strong> has been successfully delivered to your shipping address.</div>
    <div class="p">We hope you love your new outfit! If you have any questions or feedback, reach out to our team anytime.</div>
    <div style="text-align:center;margin-top:24px;">
      <a href="${FRONTEND_URL}/account/orders" class="btn">Rate & Review Products</a>
    </div>
  `;
  const text = `Hi ${data.customerName}, Order #${data.orderNumber} has been delivered. View order details at ${FRONTEND_URL}/account/orders`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 6. Order Cancelled Template
export function getOrderCancelledTemplate(data: { customerName: string; orderNumber: string; isRefundPending?: boolean }) {
  const title = `Order Cancelled - #${data.orderNumber}`;
  const content = `
    <div class="h1">Order Cancelled</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, order <strong>#${escapeHtml(data.orderNumber)}</strong> has been cancelled.</div>
    ${data.isRefundPending ? `<div class="p" style="color:#3B82F6;">A full refund has been initiated and will be credited back to your original payment method within 5-7 business days.</div>` : ''}
  `;
  const text = `Hi ${data.customerName}, Order #${data.orderNumber} was cancelled.`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 7. Refund Processed Template
export function getRefundProcessedTemplate(data: { customerName: string; orderNumber: string; amount: number; refundId?: string }) {
  const title = `Refund Processed - Order #${data.orderNumber}`;
  const content = `
    <div class="h1" style="color:#10B981;">Refund Successfully Processed</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, a refund of <strong>₹${data.amount.toLocaleString()}</strong> for order <strong>#${escapeHtml(data.orderNumber)}</strong> has been processed.</div>
    ${data.refundId ? `<div class="p" style="font-size:12px;color:#64748B;">Refund Ref: ${escapeHtml(data.refundId)}</div>` : ''}
    <div class="p">Funds typically reflect in your bank account within 3-5 business days depending on your bank.</div>
  `;
  const text = `Hi ${data.customerName}, refund of ₹${data.amount} for Order #${data.orderNumber} has been processed.`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 8. Return Status Update Template
export function getReturnStatusTemplate(data: { customerName: string; returnNumber: string; status: string; reason?: string }) {
  const title = `Return Request ${escapeHtml(data.status)} - #${data.returnNumber}`;
  const content = `
    <div class="h1">Return Request Update</div>
    <div class="p">Hi ${escapeHtml(data.customerName)}, your return request <strong>#${escapeHtml(data.returnNumber)}</strong> status has been updated to: <span class="badge badge-info">${escapeHtml(data.status)}</span>.</div>
    ${data.reason ? `<div class="p" style="color:#94A3B8;">Note: ${escapeHtml(data.reason)}</div>` : ''}
  `;
  const text = `Hi ${data.customerName}, Return #${data.returnNumber} status is now ${data.status}.`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}

// 9. Password Reset Template
export function getPasswordResetTemplate(data: { email: string; resetToken: string }) {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${data.resetToken}`;
  const title = `Password Reset Request - Samrat Fashion`;
  const content = `
    <div class="h1">Reset Your Password</div>
    <div class="p">We received a request to reset the password for your Samrat Fashion account. Click the button below to set a new password:</div>
    <div style="text-align:center;margin-top:24px;">
      <a href="${resetUrl}" class="btn">Reset Password</a>
    </div>
    <div class="p" style="font-size:12px;color:#64748B;margin-top:24px;">This link is valid for 60 minutes. If you did not request a password reset, please ignore this email.</div>
  `;
  const text = `Reset your password at: ${resetUrl}`;
  return { subject: title, html: renderBrandedEmailHtml(title, content), text };
}
