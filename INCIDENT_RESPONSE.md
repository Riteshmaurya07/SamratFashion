# Samrat Fashion — Incident Response & Security Runbook (Phase 12A)

---

## 1. Incident Severity Definitions

- **P0 — Critical Outage**: Core storefront unavailable, database unreachable, or payment processing failing for all users.
- **P1 — Major Degradation**: Specific feature failing (e.g. invoice generation or admin fulfillment queue) with partial customer impact.
- **P2 — Minor Degradation**: Non-critical issue (e.g. delay in notification logging or minor UI alignment issue).

---

## 2. Emergency Operational Protocols

### Protocol A: Database Outage or Corruption
1. Immediately inspect backend logs for connection errors or Atlas alert notifications.
2. Check MongoDB Atlas cluster health console.
3. If database restoration is required:
   - Identify point-in-time recovery target.
   - Follow procedures in [`DISASTER_RECOVERY.md`](file:///d:/code/samratFashion/DISASTER_RECOVERY.md).
   - Ensure `restoreGuard.ts` target environment verification is strictly respected.

### Protocol B: Payment Gateway Anomaly or Webhook Failure
1. Inspect `WebhookEvent` records for `FAILED` status entries.
2. Verify Razorpay API status dashboard.
3. If webhook signature verification fails repeatedly, verify `RAZORPAY_WEBHOOK_SECRET` in environment variables.
4. Perform manual reconciliation between Razorpay dashboard and internal `Payment` records before updating order statuses.

### Protocol C: Credential Exposure or Security Leak
1. Immediately revoke compromised API keys or tokens in external provider portals (Razorpay, Brevo, Delhivery, MongoDB Atlas).
2. Update backend environment variables in Render deployment settings.
3. Trigger redeployment of backend service.
4. Audit `AuditLog` for unauthorized administrative access during exposure window.
