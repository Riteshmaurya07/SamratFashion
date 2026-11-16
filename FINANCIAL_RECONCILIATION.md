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

### Scenario A: Payment Captured in Razorpay, Order Pending/FAILED in DB
- **Cause**: Webhook network drop, client closed the browser before `/payments/verify` finished, or a `payment.failed` event for an earlier attempt on the same Razorpay order raced the successful capture.
- **Resolution**: Run the guarded repair tool (dry run first, it verifies the capture with Razorpay before writing):
  ```powershell
  cd backend
  $env:MONGODB_URI = "<production connection string>"
  node dist/scripts/reconcileCapturedPayment.js --order <orderNumber> --payment <pay_xxx>
  node dist/scripts/reconcileCapturedPayment.js --order <orderNumber> --payment <pay_xxx> --confirm
  ```
  It reuses the idempotent `processPaymentSuccess` path (stock, invoice, notifications) and refuses to run when the attempt/payment/order linkage does not match, when a refund already exists, or when a second capture must be refunded instead.
- **Never ask the customer to retry payment** while a capture is unreconciled: `POST /api/payments/create-order` returns `409 PAYMENT_RECONCILIATION_REQUIRED` to prevent a double charge.

### Scenario C: Captured Payment on a Closed (EXPIRED/CANCELLED) Order
- **Cause**: The 15-minute expiry reaper closed the order before the capture arrived.
- **Behaviour**: The capture is recorded on the `Payment` (`status: CAPTURED`, `razorpayPaymentId`) and flagged with `reconciliationRequired: true`; the order is not resurrected automatically.
- **Resolution**: Either refund the customer (Razorpay dashboard, or fix the records and use the admin refund) or revive and reconcile with `--revive` if the goods can still be shipped.

### Scenario B: Customer Cancelled Payment in Modal
- **Cause**: User closed Razorpay modal (`modal.ondismiss`).
- **Resolution**: `PaymentAttempt` remains `PENDING`/`FAILED`. Cart items remain in user's bag. **Zero stock deducted**. **Zero invoice generated**.

---

## 3. SECURITY & AUDIT TRAIL

- All financial actions (`ADMIN_SUPPORT_STATUS_CHANGED`, `ADMIN_REFUND_ISSUED`) are logged in `AuditLog`.
- Financial credentials and webhook HMAC signatures are validated on server-side only. Zero secrets stored on client.
