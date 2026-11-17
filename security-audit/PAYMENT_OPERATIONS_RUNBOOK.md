# PAYMENT OPERATIONS RUNBOOK — 2026-11-17

Operational guide for running the SamratFashion payment/refund system in
production. It covers the failure mode that matters most on managed hosting:
**the recovery loop does not run on serverless.**

Companion documents:
- `security-audit/PAYMENT_REFUND_LOGIC_AUDIT_2026-11-17.md` — logic audit.
- `backend/src/services/payment/paymentHealthService.ts` — health report.
- `backend/src/routes/opsRoutes.ts` — operational endpoints.

---

## 0. TL;DR

| Item | Value |
|---|---|
| Health probe | `GET /api/ops/payments/health` |
| Run one recovery cycle | `GET` or `POST /api/ops/recovery/run` |
| Auth | `x-ops-secret: <OPS_SECRET>` or `Authorization: Bearer <OPS_SECRET>` |
| Response | `200` for `ok`/`degraded`, `503` for `critical` |
| Minimum schedule | every 1–5 minutes |
| Serverless requirement | `DISABLE_EMBEDDED_RECOVERY=true` + external cron |

---

## 1. Why payments get stuck on serverless

`backend/src/index.ts` starts the recovery loop in-process:

```ts
if (process.env.DISABLE_EMBEDDED_RECOVERY !== "true") {
  RecoveryCoordinatorService.startRecoveryScheduler();
}
```

`startRecoveryScheduler` uses `setTimeout` + `setInterval(...).unref()`
(`recoveryCoordinatorService.ts`). On Vercel, Netlify, AWS Lambda, or any
freeze-after-response host:

- code only runs while a request is active;
- timers are frozen or the process is discarded after the response;
- therefore webhook retries, stuck-refund reconciliation, inventory
  restoration, and cancellation recovery **do not run**.

The webhook request itself is processed when Razorpay calls it. But if that
request times out, crashes mid-way, or the event is stored as `FAILED`, nothing
replays it. Unpaid orders are also never reaped by the separate order-expiry
scheduler.

This is the first thing to fix. It is a deployment change, not a code rewrite.

---

## 2. Supported deployment modes

### Mode A — always-on process (VPS, Render web service, Fly, Railway)

```env
DISABLE_EMBEDDED_RECOVERY=true
```

Run the API and the worker:

```bash
npm run start          # API
npm run start:worker   # recovery worker
```

The database lease (`RECOVERY_COORDINATOR_LEADER`) makes multiple workers safe,
but one is enough for a single store.

### Mode B — serverless + external cron (recommended for Vercel/Netlify)

```env
DISABLE_EMBEDDED_RECOVERY=true
```

1. Configure a cron job to call `/api/ops/recovery/run` every 1–5 minutes.
2. Point your uptime monitor at `/api/ops/payments/health`.
3. Keep the function timeout at least 60 seconds if your plan allows it.
   If the cycle times out, lower `batchLimit` (for example `10`).

Do **not** leave the embedded scheduler enabled on serverless. The health report
raises a `critical` alert when it detects that combination.

---

## 3. Required environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | Yes | **Replica set / Atlas**. Production exits at boot without transaction support. |
| `NODE_ENV` | Yes | `production`. |
| `RAZORPAY_KEY_ID` | Yes | Live or test key. |
| `RAZORPAY_KEY_SECRET` | Yes | Used for payment signature verification. |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | Must match the Razorpay webhook secret exactly. |
| `ALLOW_PAYMENT_MOCK` | Yes | Must be `false` in production/staging. |
| `OPS_SECRET` | Yes | ≥16 chars; generate with the command below. |
| `DISABLE_EMBEDDED_RECOVERY` | Serverless | `true` when using cron or a separate worker. |
| `RECOVERY_WORKER_INTERVAL_MS` | No | Worker-only interval, default `30000`. |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never expose the secret to the frontend. Send it only from the cron provider and
your monitoring service.

---

## 4. Razorpay webhook configuration

In Razorpay Dashboard → Settings → Webhooks:

| Setting | Value |
|---|---|
| URL | `https://<api-host>/api/webhooks/razorpay` |
| Secret | Same value as `RAZORPAY_WEBHOOK_SECRET` |
| Events | `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed` |

The raw body is mounted before JSON parsing (`index.ts`), and the signature is
checked with `crypto.timingSafeEqual`. Do not move the webhook route behind a
JSON body parser or auth middleware.

After deploying, send a test webhook from the dashboard and confirm:
1. the delivery returns `2xx`;
2. `WebhookEvent` gets a `PROCESSED` row;
3. the health report's `webhooks.failed` stays at `0`.

---

## 5. Health probe

```bash
curl -sS -H "x-ops-secret: $OPS_SECRET" \
  "https://<api-host>/api/ops/payments/health"
```

`200` = `ok` or `degraded`; `503` = `critical`.

| Field | Meaning | Action |
|---|---|---|
| `payments.reconciliationRequired` | A capture exists but was not safely applied to an order | Critical. Reconcile the specific payment before allowing another payment. |
| `payments.stuckAttempts` | Payment attempt stuck `PENDING`/`PROCESSING` | Check Razorpay and the order; run recovery. |
| `payments.stuckOrders` | Unpaid order older than 30 minutes | Usually abandoned checkout; confirm no capture exists before expiry. |
| `refunds.stuck` | Refund stuck `PENDING`/`PROCESSING` | Check `submissionState`, Razorpay refund status, then run recovery. |
| `refunds.failedRetryable` | Refund ended `FAILED` | Expected after a gateway rejection; retry from admin when appropriate. |
| `refunds.unknown` | Gateway outcome unconfirmed | Critical. **Do not retry.** Reconcile against Razorpay first. |
| `refunds.reconciliationRequired` | Local ledger could not be settled atomically | Critical. Manual verification required. |
| `refunds.processedButUnsettled` | Gateway says processed, local accounting not complete | Critical. This is the D3-class failure; run recovery and inspect. |
| `refunds.paymentsWithPendingReservations` | Reserved refund balance still held | Usually transient; investigate if it persists. |
| `webhooks.failed` | Events in the durable inbox marked `FAILED` | Recovery replays them. If recovery is stale, this escalates. |
| `webhooks.staleProcessing` | Worker lease expired mid-event | Reclaimed automatically by recovery. |
| `recovery.lastRunCompletedAt` | Last successful cycle | If older than 10 minutes, recovery is stale. |
| `recovery.schedulerMode` | `embedded` or `external` | On serverless it must be `external`. |
| `configuration.*` | Presence booleans only; no secrets | Fix any missing/false value before launch. |

Samples include the first five affected document ids so you can jump straight to
the record. `windows` shows the thresholds in minutes (defaults: payment attempt
and refund 15, unpaid order 30, recovery staleness 10).

---

## 6. Recovery cron

```bash
curl -sS -X POST -H "x-ops-secret: $OPS_SECRET" \
  "https://<api-host>/api/ops/recovery/run?batchLimit=20"
```

The endpoint runs exactly one coordinated cycle and returns its report. It is
safe to call repeatedly:

- a distributed lease prevents overlapping cycles;
- every step is idempotent;
- `executed: false` with `skippedReason: "LOCKED_BY_ANOTHER_INSTANCE"` is normal
  and not an error.

`batchLimit` is clamped to `1..100` (default `20`). Lower it if the platform
kills the function before the cycle finishes.

### Vercel Cron

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/ops/recovery/run?batchLimit=10", "schedule": "*/2 * * * *" }
  ]
}
```

Vercel sends `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET` to the same
value as `OPS_SECRET`. Check your plan's minimum cron frequency (Hobby is more
restrictive than Pro); if it cannot run every few minutes, use an external cron.

### GitHub Actions

```yaml
name: payment-recovery
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}
jobs:
  recover:
    runs-on: ubuntu-latest
    steps:
      - name: Run recovery cycle
        run: |
          curl -fsS -X POST \
            -H "x-ops-secret: ${{ secrets.OPS_SECRET }}" \
            "https://<api-host>/api/ops/recovery/run?batchLimit=20"
```

### cron-job.org / any scheduler

- URL: `https://<api-host>/api/ops/recovery/run?batchLimit=20`
- Method: `POST` (GET also works)
- Header: `x-ops-secret: <OPS_SECRET>`
- Treat `HTTP 2xx` as success; inspect the JSON if `executed` is false.

---

## 7. Triage playbook

### A. Customer says “money was deducted but the order is not confirmed”

1. Call the health probe and check `payments.reconciliationRequired`,
   `payments.stuckOrders`, and the samples.
2. Open the Razorpay dashboard and confirm the payment status **by
   `razorpayPaymentId`**, not by amount.
3. If Razorpay shows `captured` and the local order is unpaid, dry-run the
   reconciliation script:

   ```bash
   npm run reconcile:payment -- --order <orderNumber|id> --payment pay_xxx
   ```

   Review the output, then apply:

   ```bash
   npm run reconcile:payment -- --order <orderNumber|id> --payment pay_xxx --confirm
   ```

4. **Never** ask the customer to pay again and never create a second Razorpay
   payment for the same order. `createPaymentOrder` blocks this by design.
5. If Razorpay shows `failed`, the order can be retried normally.

### B. Refund is stuck

1. Health probe: `refunds.stuck` + samples. Record the refund id.
2. Admin endpoint: `GET /api/admin/orders/:id/refunds`.
3. Check `status`, `submissionState`, `accountingSettlementStatus`,
   `razorpayRefundId`, `failureReason`.
4. Run one recovery cycle.
5. Compare with Razorpay Dashboard → Refunds:
   - Razorpay `processed` + local `PENDING` → recovery should settle it; if it
     still does not, capture the ids and escalate.
   - Razorpay `failed` → the reservation should be released and the refund
     marked `FAILED`; retry from admin if appropriate.
   - No refund at Razorpay + `submissionState` `INTENT_CREATED` → recovery
     re-claims and submits.
6. **`UNKNOWN` or `RECONCILIATION_REQUIRED` → do not retry.** Verify the gateway
   outcome first. A retry can double-refund.

### C. Webhooks are failing

1. Razorpay Dashboard → Webhooks → deliveries: check the response code and body.
2. Verify `RAZORPAY_WEBHOOK_SECRET` matches exactly.
3. Verify the URL is reachable and not behind auth/JSON parsing.
4. Check `webhooks.failed` and the sample `eventId`s.
5. Run recovery; it replays up to 10 attempts per event
   (`processingAttempts < 10`).
6. If events are exhausted, fix the root cause and re-send from Razorpay.

### D. Recovery is stale

1. Check that the cron is actually running (provider logs).
2. Check `OPS_SECRET`/`CRON_SECRET` and the exact URL.
3. Call the endpoint manually; a `401` means the secret is wrong, `503` means
   `OPS_SECRET` is unset.
4. If the cycle times out, reduce `batchLimit`.
5. Confirm `DISABLE_EMBEDDED_RECOVERY=true` on serverless and that the health
   report shows `schedulerMode: "external"`.

---

## 8. Deploy checklist

- [ ] MongoDB is a replica set / Atlas; the app boots without the transaction
      fatal error.
- [ ] `NODE_ENV=production`, `ALLOW_PAYMENT_MOCK=false`.
- [ ] Razorpay key id, key secret, and webhook secret are set.
- [ ] Webhook URL and the four events are configured in Razorpay.
- [ ] `OPS_SECRET` is set (≥16 chars) and stored only in the backend/cron.
- [ ] Serverless: `DISABLE_EMBEDDED_RECOVERY=true` + cron every 1–5 minutes.
- [ ] Always-on: API + worker running, API has embedded recovery disabled.
- [ ] Uptime monitor calls `/api/ops/payments/health` and alerts on `503`.
- [ ] One real test-mode payment and one test-mode refund complete end to end.
- [ ] `payment-health`, `refund-retry-concurrency`, `payment-idempotency`,
      and `phase7-refund-webhook` suites pass against the release build.

---

## 9. Do not

- Do not delete or “clean up” `reconciliationRequired`,
  `accountingSettlementStatus`, or reservation rows by hand.
- Do not retry a refund in `UNKNOWN` or `RECONCILIATION_REQUIRED`.
- Do not create a second payment for an order that may already be captured.
- Do not enable `ALLOW_PAYMENT_MOCK` in production.
- Do not run production on standalone MongoDB; transactions are required.
- Do not rely on the embedded scheduler on serverless, even if it appears to run
  during a warm request.

---

## 10. Known gaps after this change

1. **Order expiry and log cleanup are separate in-process schedulers.** On
   serverless they are still frozen. The recovery cron does not run
   `expireStalePendingOrders()`; stale unpaid orders are reported by
   `payments.stuckOrders` but not automatically closed. A follow-up cron
   endpoint should cover this.
2. **No alert delivery inside the app.** The health endpoint exposes the state;
   you must connect it to email/Slack/PagerDuty/uptime monitoring.
3. **COD, disputes/chargebacks, settlement reconciliation, and multi-gateway**
   are not implemented. They are product features, not defects in the current
   refund logic.
