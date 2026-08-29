# SAMRAT FASHION — FINANCIAL RECONCILIATION RUNBOOK (PHASE 12D)

---

## 1. DAILY RECONCILIATION WORKFLOW (09:00 IST)

The Admin Finance Operator performs daily matching between Razorpay settlements and MongoDB database records:

1. **Export Razorpay Payments Report**: Download CSV from Razorpay Merchant Dashboard (`Captured`, `Failed`, `Refunded`).
2. **Query DB Payment Collection**: Execute backend reconciliation query:
   ```javascript
   db.payments.aggregate([
     { $group: { _id: "$status", totalAmount: { $sum: "$amount" }, count: { $sum: 1 } } }
   ]);
   ```
3. **Verify 1:1 Match**:
   - Every `CAPTURED` Razorpay Payment must map to exactly one `PAID` / `CONFIRMED` Order in DB.
   - Every `REFUNDED` payment must map to an official `Refund` document with matching `razorpayRefundId`.
4. **Flag Mismatches**: Any payment marked `CAPTURED` in Razorpay but `PENDING` in DB is reconciled using `processPaymentSuccess(razorpayOrderId, razorpayPaymentId)`.

---

## 2. ANOMALY RESOLUTION PROCEDURES

### Scenario A: Payment Captured in Razorpay, Order Pending in DB
- **Cause**: Webhook network drop or client closed browser before `/payments/verify` finished.
- **Resolution**: Run server-side verification: `POST /api/payments/verify` with `razorpay_payment_id` and `razorpay_order_id`. System processes payment idempotently.

### Scenario B: Customer Cancelled Payment in Modal
- **Cause**: User closed Razorpay modal (`modal.ondismiss`).
- **Resolution**: `PaymentAttempt` remains `PENDING`/`FAILED`. Cart items remain in user's bag. **Zero stock deducted**. **Zero invoice generated**.

---

## 3. SECURITY & AUDIT TRAIL

- All financial actions (`ADMIN_SUPPORT_STATUS_CHANGED`, `ADMIN_REFUND_ISSUED`) are logged in `AuditLog`.
- Financial credentials and webhook HMAC signatures are validated on server-side only. Zero secrets stored on client.
