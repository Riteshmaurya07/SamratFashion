# Samrat Fashion — Disaster Recovery & Backup Plan (Phase 11A)

---

## 1. Overview & Architecture

Samrat Fashion utilizes **MongoDB Atlas** (ReplicaSet cluster `cluster0.nl5bdfe.mongodb.net`) as its primary database system. The production environment relies on Atlas managed continuous cloud backups, automated snapshots, and point-in-time recovery (PITR).

| Parameter | Configuration / Metric |
|---|---|
| **Database Provider** | MongoDB Atlas (Managed Cloud ReplicaSet) |
| **Deployment Model** | 3-Node Replica Set (`atlas-r2673o-shard-0`) |
| **Managed Backup System** | Continuous Cloud Backup & Automated Snapshots |
| **Backup Frequency** | Continuous Oplog + Automated Hourly/Daily Snapshots |
| **Snapshot Retention** | 7 to 30 Days (Atlas Retention Policy) |
| **RPO (Recovery Point Objective)** | **< 1 Minute** (Continuous oplog streaming) |
| **RTO (Recovery Time Objective)** | **5 to 15 Minutes** (Snapshot restore to isolated database) |
| **Secret Management** | **0 Database Secrets** (Secrets reside in backend `.env`) |
| **Production Guard** | [`restoreGuard.ts`](file:///d:/code/samratFashion/backend/src/utils/restoreGuard.ts) strictly blocks restore operations on `NODE_ENV=production` |
| **Restore Verification** | Tested & Verified via [`backend/src/tests/test-backup-restore-e2e.js`](file:///d:/code/samratFashion/backend/src/tests/test-backup-restore-e2e.js) |

---

## 2. Backup Scope & Data Collections

The automated database backup covers all 23 application collections:

- `User`, `Address`, `Session`, `PasswordResetToken`
- `Category`, `Theme`, `Product` (and Variant subdocuments)
- `Cart`, `Order`, `Payment`, `PaymentAttempt`, `Invoice`
- `Shipment`, `Fulfillment`, `LogisticsEventLog`
- `ReturnRequest`, `Refund`, `InventoryTransaction`
- `CustomDesign`, `PrintJob`, `BulkOrderRequest`, `BulkQuote`
- `SupportTicket`, `CustomerReview`, `AuditLog`, `WebhookEvent`, `NotificationLog`

---

## 3. Asset & Media Recovery

1. **Product Images & Banners**: Hosted via HTTP/HTTPS URLs stored in `Product.images`, `Category.image`, and `Theme.heroImage`.
2. **Custom Design Artworks**: Vector elements, text objects, and preview URLs stored in `CustomDesign.canvasElements` and `CustomDesign.previewImage`.
3. **Invoices & Slips**: Streamed dynamically via `pdfkit` using stored order & tax snapshots in MongoDB (`Order`, `Fulfillment`).
4. **Asset Recovery SLA**: Restoring MongoDB restores all dynamic reference URLs.

---

## 4. Production Protection Guard

The application enforces a fail-closed guard in [`restoreGuard.ts`](file:///d:/code/samratFashion/backend/src/utils/restoreGuard.ts):

```typescript
import { assertRestoreTargetSafe } from './utils/restoreGuard';

// Throws FATAL RESTORE GUARD ERROR if NODE_ENV=production or RESTORE_TARGET=production
assertRestoreTargetSafe({ targetEnv: process.env.RESTORE_TARGET });
```

---

## 5. Emergency Disaster Recovery & Restore Procedure

In the event of a critical database outage or data corruption:

1. **Do NOT overwrite production directly**.
2. Provision an isolated target database (e.g. `samrat_fashion_staging` or `samrat_fashion_restore_test`).
3. Restore the MongoDB Atlas snapshot or mongodump archive to the isolated target.
4. Run validation checks:
   - Run `node backend/src/tests/test-backup-restore-e2e.js` against target.
   - Verify collection counts and primary keys (`Order._id`, `orderNumber`, `awbNumber`, `razorpayPaymentId`).
   - Confirm reference integrity (`Order -> User`, `Payment -> Order`, `Shipment -> Order`).
5. Update backend connection string `MONGODB_URI` to point to the validated restored database.
6. Verify no external API calls (Razorpay, Delhivery, Brevo) are re-triggered on startup (`NotificationLog` and `WebhookEvent` provide idempotency).

---

## 6. Idempotency & Webhook Safety During Recovery

- **Payment Webhooks**: Handled via `WebhookEvent` compound unique index `{ provider, eventId }`. Old webhooks are skipped.
- **Logistics Webhooks**: Handled via `LogisticsEventLog` unique index `providerEventId`. Courier updates are not re-executed.
- **Transactional Emails**: Handled via `NotificationLog` unique `idempotencyKey`. Duplicate emails are skipped.
- **Inventory Deductions**: Handled via `InventoryTransaction` compound unique index `{ orderId, variantId, type }`. No double deductions occur.
