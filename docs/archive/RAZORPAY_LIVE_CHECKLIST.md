# SAMRAT FASHION — RAZORPAY LIVE ACTIVATION CHECKLIST (PHASE 12D)

---

## 1. PRE-SWITCH AUDIT & GO-LIVE REQUIREMENTS

| Audit Step | Requirement | Status |
|---|---|---|
| **Merchant KYC** | Verified Razorpay Business Account & Bank Settlement Account | Pending Merchant Setup |
| **Razorpay LIVE Key ID** | `RAZORPAY_KEY_ID` set to `rzp_live_...` in Render backend env | Ready for Configuration |
| **Razorpay LIVE Key Secret** | `RAZORPAY_KEY_SECRET` set in Render backend env | Ready for Configuration |
| **Razorpay LIVE Webhook Secret** | `RAZORPAY_WEBHOOK_SECRET` set in Render backend env | Ready for Configuration |
| **Production Webhook URL** | `https://samratfashion.onrender.com/api/webhooks/razorpay` registered in Razorpay Dashboard | Ready for Registration |
| **Active Webhook Events** | `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed` | Configured in Controller |
| **HTTPS Domain** | `https://samrat-fashion.vercel.app` SSL / TLS Active | Active |

---

## 2. CONTROLLED PRODUCTION VERIFICATION WORKFLOW

```
1. Operator configures RAZORPAY_KEY_ID (rzp_live_...) & secrets in Render backend.
2. Operator registers Webhook URL in Razorpay LIVE dashboard.
3. Operator places 1 controlled test order for a low-value item (e.g. ₹10.00).
4. Operator completes live payment using real UPI / Card.
5. System verifies signature, processes webhook, marks order PAID, deducts stock, and generates invoice.
6. Operator verifies order confirmation page and checks Razorpay settlement dashboard.
```

---

## 3. ROLLBACK & INCIDENT PROCEDURES

If an anomaly occurs during live payment processing:

1. **Disable Live Checkout**: Set `ALLOW_PAYMENT_MOCK=false` and revert key to test mode or display maintenance banner.
2. **Preserve Financial Records**: Do **NOT** delete MongoDB database records or order history.
3. **Reconcile Mismatch**: Compare Razorpay Dashboard payment IDs against `PaymentAttempt` and `Order` documents.
4. **Issue Authorized Refund**: Refund via Razorpay dashboard or Admin Refund endpoint if customer account was charged without order fulfillment.
