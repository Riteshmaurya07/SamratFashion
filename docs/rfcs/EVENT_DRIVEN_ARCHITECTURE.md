# Event-Driven Architecture

> **Scope:** SamratFashion / THREADVIBE monorepo (`backend/` Express 5 + Mongoose, `frontend/` Next.js 16 + Zustand).
> **Status:** Target architecture (not yet implemented). Every claim below is grounded in the current codebase; cited `file:line` references are evidence of the *current* state.

---

## 1. Why Event-Driven?

### 1.1 Current reality: a synchronous monolith

The backend is a single Express process. There is **no message queue, no worker process, no in-process `EventEmitter`, no cron scheduler, no SSE/WebSocket channel** anywhere in `backend/src` or `frontend/src` (verified by exhaustive search; zero matches for `EventEmitter`, `setInterval`/`setTimeout` in `backend/src`, no queue/worker packages in `backend/package.json`).

The only async mechanisms that exist today are *ad hoc* and provider-facing:

| Mechanism | Location | What it does |
|---|---|---|
| Razorpay webhook | `backend/src/controllers/webhookController.ts` | Signature-verified inbound webhook; dedup ledger `WebhookEvent` (`{provider, eventId}` unique index, `models/WebhookEvent.ts:19`) with `IGNORED → PROCESSED` transition |
| Logistics webhook | `backend/src/controllers/logisticsWebhookController.ts` | Delhivery status push; dedup ledger `LogisticsEventLog` (unique `providerEventId`, `models/LogisticsEventLog.ts:12`) |
| Notification log | `backend/src/services/notifications/notificationService.ts` | `NotificationLog` upserted with unique `idempotencyKey` (`models/NotificationLog.ts:37`) — a de-facto outbox table |
| Audit log | 74 call sites across 19 controllers | `AuditLog.create({actorId, actorRole, action, entityType, entityId, metadata})` |

### 1.2 Pain points identified during analysis

1. **The fattest synchronous handler in the system is `processPaymentSuccess`** (`backend/src/services/payment/paymentProcessor.ts:8-190`). A single request (payment verify **or** webhook) synchronously does: atomically decrement inventory + write `InventoryTransaction` (37-55), confirm the order (`PAID`/`CONFIRMED`, 63-65), **await two email sends in-request** (74-101), consume coupon counters + write `CouponUsage` (107-139), consume the cart (142-173), and capture `PaymentAttempt`/`Payment` (176-182). Any failure mid-chain leaves a partially-consistent order.
2. **Notifications block the business transaction.** `notificationService.notify()` calls the email provider *inside* the request (`notificationService.ts:74-75`) before upserting the log (84-102). Response latency and downstream failures are coupled to a third-party SMTP/API.
3. **Six email templates are dead code.** `PAYMENT_FAILED`, `ORDER_SHIPPED`, `ORDER_DELIVERED`, `ORDER_CANCELLED`, `REFUND_PROCESSED`, `RETURN_STATUS_UPDATED/RETURN_APPROVED/RETURN_REJECTED` all have templates (`notificationService.ts:140-153`) but the **only** dispatch sites in the whole codebase are `paymentProcessor.ts:74,89` (`ORDER_CONFIRMED`, `PAYMENT_SUCCESS`) and `emailService.ts:9` (`PASSWORD_RESET`). Shipping, delivery, refund, return transitions are never emailed to customers.
4. **Refunds are synchronous Razorpay API calls inside the request** — initiated from three places: customer cancel (`orderController.ts:279-285`), admin refund (`refundController.ts:14-41` → `refundService.ts:80-84`), and accept-return (`returnController.ts:287-293`). No retry/backoff; failure is swallowed in some paths (`orderController.ts` try/catch).
5. **Oversell window between order placement and payment.** `createOrder` validates stock but never decrements it (`orderController.ts:73-76`); decrement happens only at `payment.captured` (`paymentProcessor.ts:37-55`). The stock `$inc` and `InventoryTransaction` insert are not in one DB transaction (28-60), relying on a sparse unique index.
6. **The Order state machine is duplicated in at least three places**: the enum (`models/Order.ts:97-108`), the admin transition table (`adminController.ts:179-186`), and ad-hoc guards in `orderController.ts:251-269`, `logisticsWebhookController.ts:106-120`, `shipmentController.ts:342-353`.
7. **Print production has no producer event.** `PrintJob` records are auto-created as a side effect of *admin GET list/detail endpoints* (`adminCustomOrderController.ts:57-64, 252-259`) rather than at payment success. CPU-heavy ZIP/SVG exports run in the request (`adminProductionController.ts:201-292`, `adminCustomOrderController.ts:418-481`).
8. **Frontend "realtime" is polling.** Exactly four loops exist: support ticket thread (5s), admin ticket thread (5s), admin support queue (10s), and order-confirmation while payment is `PENDING` (5s) — all gated on `visibilityState`. The "Live Status" shipment UI (`OrderDetailsClient.tsx:203-247`) never updates itself. The only custom DOM event in the app is `auth-expired` (`frontend/src/lib/api.ts:92` → `AuthProvider.tsx:46`).
9. **Analytics is client-only GA4.** ~30 events fire to Google directly; **no backend ingestion endpoint exists** — the internal "analytics" route is only production KPI aggregates (`adminProductionController.ts:110-150`).
10. **No automated retry, backoff, or dead-letter handling.** Idempotency ledgers exist (`WebhookEvent`, `LogisticsEventLog`, `NotificationLog`), but nothing reschedules failed work.

These are exactly the symptoms event-driven architecture (EDA) addresses: **decouple producers from consumers, persist intended side effects, and make every boundary idempotent.**

---

## 2. Design Principles

1. **Domain events are facts.** An event records something that *already happened* (`order.captured`, `shipment.delivered`) — past tense, immutable, never a command.
2. **Producers never wait for consumers.** The HTTP request's only job is to mutate its own aggregate and append one `DomainEvent` to the **outbox** inside the same DB transaction. Everything downstream is a consumer.
3. **Every consumer is idempotent.** Same event delivered twice → same state. The codebase already models this correctly (`WebhookEvent`, `LogisticsEventLog`, `NotificationLog` unique keys, sparse inventory index `{orderId, variantId, type}`); consumers generalize that pattern.
4. **Events are the integration contract.** No consumer depends on another module's function; it subscribes to an event type with a versioned schema.
5. **One reason to couple, one reason to buffer.** Keep synchronous reads (checkout totals, admin dashboards) on REST; use events for **side effects**, **fan-out**, and **state propagation**.
6. **Progressive path.** Start in-process + MongoDB outbox (zero new infrastructure). Graduate to a broker or worker pool only where throughput/latency demands it.

---

## 3. Target Topology

```
                    ┌─────────────────────────── Express/Next.js monolith ───────────────────────────┐
                    │                                                                                │
  REST/HTTP         │   Controllers (producers)            Consumers (handlers)                       │
 ──────────►        │   orderController ─┐                 ├─ orderService     (PAID/CONFIRMED)      │
                    │   paymentController├─┐              ├─ inventoryService (stock - InventoryTxn) │
  Razorpay webhook  │   webhookController│ │   DomainEvent │─ notificationService (email/SMS)        │
 ──────────►        │   refund/return/...┘ │  ┌──────────┐ │─ couponService    (usage counters)      │
  Delhivery webhook │                     └─►│ Outbox    │─ cartService      (cart consumption)      │
 ──────────►        │     aggregate change + │ (MongoDB) │─ printService     (PrintJob creation)     │
                    │     append event atomically │        │─ auditService     (AuditLog)            │
                    └─────────────────────────────────────│─ analyticsService (ingest)              │
                                                          │─ sseGateway      (frontend push)        │
                                                          │─ logisticsService (pickup/create)       │
                                                          └─────────────────────────────────────────┘
                                                                                 │
                                                   OutboxDispatcher (poll or    │
                                                   Change Streams / worker)     ▼
                                                                        ┌────────────┐
                                                                        │  SSE (/api/│
                                                                        │  events/   │
                                                                        │  stream)   │
                                                                        └────────────┘
                                                                              │
                                                                        Next.js 16 client
                                                                        (Zustand stores refresh)
```

**Three runtimes evolve out of the current single process:**

| Runtime | Process | Role |
|---|---|---|
| **API** | `node dist/index.js` (existing) | REST + webhooks; writes aggregate + outbox in one transaction |
| **Dispatcher / Consumer** | new `dist/workers/dispatcher.js` (first pass: `setInterval` poller in-process; later: BullMQ consumer or `mongo-changestream`) | Reads `PENDING` outbox rows, publishes to the in-process bus or a broker |
| **SSE Gateway** | mounted in API process | Authenticated `text/event-stream` push to the frontend |

> **Rationale for DB-outbox-first:** the app has no Redis/Kafka/RabbitMQ today and the deployment is a single Node process (`backend/package.json` scripts have no worker). A MongoDB-backed outbox is the only option that is transactional with existing writes. A broker (`redis-streams`, `RabbitMQ`, Kafka) can slot in later behind the same `EventPublisher` interface (Section 7).

---

## 4. Core Building Blocks

### 4.1 Event envelope

New collection `events` (model `DomainEvent`), fields:

| Field | Type | Notes |
|---|---|---|
| `eventId` | string | UUIDv7; global unique index (outbox dedupe / consumer dedupe) |
| `type` | string | `order.captured`, `shipment.delivered`, … (Section 5 lists the full catalog) |
| `version` | int | Schema version for `payload` (consumers may support a range) |
| `occurredAt` | Date | Time the aggregate changed |
| `recordedAt` | Date | Outbox append time |
| `producer` | object | `{ service: "orders-api", requestId }` — `requestId` from `requestIdMiddleware` (`backend/src/middleware/observability.ts:51-66`, already stamps `x-request-id`) |
| `aggregate` | object | `{ type: "Order", id: ObjectId }` |
| `correlationId` | string | Links an original request/webhook through its whole event fan-out |
| `idempotencyKey` | string | Producer-provided key (reuse the existing convention e.g. `ORDER_CONFIRMED:${orderId}`); unique index |
| `payload` | Mixed | Versioned event data (Section 6 contracts) |
| `status` | `PENDING \| PUBLISHED \| FAILED` | Outbox state |
| `deliveries` | object | Per-consumer at-least-once readstate (Section 7.3) or broker offset |
| `retryCount` | number | Delivery attempts |
| `lastError`, `lastAttemptAt` | — | Dispatcher diagnostics |

Unique indexes: `{ eventId }`, `{ idempotencyKey }`.

### 4.2 Transactional outbox

Every producer mutation becomes:

```ts
// sketch — replaces the inline await-chain in paymentProcessor.ts
const session = await mongoose.startSession();
await session.withTransaction(async () => {
  // 1. mutate the aggregate (e.g. order.paymentStatus = 'PAID'; order.status = 'CONFIRMED')
  // 2. insert one DomainEvent row with status 'PENDING'
  // 3. (optional) write NotificationLog.REQUESTED row — see 4.4
});
// Request returns immediately; the outbox row is durable.
```

Constraints:
- Outbox write **must** be in the same MongoDB transaction as the aggregate mutation (the codebase already uses transactions for order creation: `orderController.ts:155-172`, with non-atomic fallback for standalone Mongo — the outbox append shares that path).
- Reuse the existing MongoDB transaction guard (`config/db.ts` transaction support + standalone fallback).

### 4.3 Dispatcher

- **Initial:** a single poller (`OutboxDispatcher`) draining `status: 'PENDING'` rows every ~500ms-1s, publishing each event to registered in-process consumers (a tiny typed `EventEmitter`-based registry: `eventBus.emit(type, event)`).
- **Scale path (unchanged interface):** replace the DB poll with `mongoose` Change Streams on `events` collection, or with BullMQ/Broker producers — consumers don't change.
- Each published event transitions `PENDING → PUBLISHED` (or `FAILED` with `retryCount++` on consumer error).
- **Backoff + DLQ:** consumers that throw are retried with exponential backoff (`retryCount`, capped). Events exceeding the cap move to `deferredEvents` collection (dead-letter) and surface in an admin panel / alert rather than silently disappearing (today, failures are swallowed with `console.error`).

### 4.4 Notifications become a consumer, not a helper

`notificationService.notify()` is refactored from "send synchronously" to "enqueue":

1. A business transaction emits domain events; a `notification` consumer maps them to `NotificationLog` rows **with status `REQUESTED`** (idempotency key preserved from today's pattern, `notificationService.ts:48-49`).
2. A dedicated email worker polls `REQUESTED → SENDING → SENT/FAILED`, calling `getEmailProvider()` (Brevo/Resend) — retrying with backoff. `attemptCount` (already in `NotificationLog.ts`) becomes a real retry counter.

This instantly resurrects the **six dead templates** (`notificationService.ts:140-153`) just by wiring consumers (Section 5 events `payment.failed`, `order.shipped`, `order.delivered`, `order.cancelled`, `refund.completed`, `return.*`).

### 4.5 Inbound event ingestion (webhooks stay)

Provider webhooks remain dedicated endpoints (signature verification is inbound-specific): `webhookController.ts`, `logisticsWebhookController.ts`. Two changes:

- **Persist the raw payload** on `WebhookEvent`/`LogisticsEventLog` so the inbound ledger is replayable (today the raw body is dropped for Razorpay).
- **The handler's only job = verify + record + emit a domain event.** The business logic moves to consumers (this is already mostly true: `webhookController.ts:53-58` delegates to `processPaymentSuccess`; that function becomes a consumer of `payment.captured` instead of being awaited by the webhook).

---

## 5. Event Catalog

Legend — **P:** producer(s) `file:line`, **C:** consumers (target), **P/S:** event currently produced synchronously / side effect currently inline. "Currently" = today's inline behavior being extracted.

### 5.1 Orders & Payments (the highest-value extraction)

| Event | Producer | Consumers | Currently |
|---|---|---|---|
| `order.created` | `orderController.createOrder` (`orderController.ts:147`) | notification (pre-confirmation), analytics, sales funnel | sync writes + idempotency key (`Order.ts:109`) |
| `payment.captured` | `paymentController.verifyPayment` (`paymentController.ts:117`) and Razorpay webhook (`webhookController.ts:53-58`) | **orderService** (→ `PAID`/`CONFIRMED`), **inventoryService** (stock `$inc` + `InventoryTransaction` `SALE`), **notificationService** (`ORDER_CONFIRMED`, `PAYMENT_SUCCESS`), **couponService** (usedCount + `CouponUsage`), **cartService** (partial consumption), **printService** (create `PrintJob` for custom line items), **analytics** (`purchase`, `payment_success`), **sse** (`orderUpdated`) | all inline in `paymentProcessor.ts:8-190` |
| `payment.failed` | Razorpay webhook `payment.failed` (`webhookController.ts:59-83`) | orderService (→ `paymentStatus: FAILED`), notification (`PAYMENT_FAILED` template exists, never fired), analytics (`payment_failed`) | inline |
| `order.cancelled` | customer `orderController.ts:273-298`; admin `adminController.ts:239` | refundService (async `createInternalRefund` — removes the sync Razorpay call at 279), inventoryService (release reservation if any), notification (`ORDER_CANCELLED`), audit, sse | sync refund API call + swallow |
| `refund.requested` | `refundService.createInternalRefund` (`refundService.ts:80-84`, called from admin refund, cancel, accept-return) | **paymentWorker** (actually call Razorpay with retry/backoff — decouples HTTP from provider), audit | sync API call in-request |
| `refund.completed` | Razorpay `refund.processed` webhook (`webhookController.ts:84-193`) | paymentService (`refundedAmount +=`, → `REFUNDED`), orderService (`paymentStatus: REFUNDED`), inventoryService (restore `REFUND`/`RETURN` transactions), returnService (→ `COMPLETED`), notification (`REFUND_PROCESSED` — never fired today) | inline |

### 5.2 Shipping & Fulfillment

| Event | Producer | Consumers | Currently |
|---|---|---|---|
| `shipment.created` | `shipmentController.createShipment` (`shipmentController.ts:75-103`) | audit, sse (`shipmentUpdated`) | inline |
| `shipment.status_changed` | Delhivery webhook (`logisticsWebhookController.ts:106-120`), `shipmentController.refreshTracking/updateShipment` (233-243, 313-369) | orderService (ripple to `SHIPPED`/`DELIVERED`), trackingService (history), notification (`ORDER_SHIPPED`, `ORDER_DELIVERED` — currently dead), sse (`shipmentUpdated` for live tracking page) | inline ripple logic duplicated (`logisticsWebhookController.ts:106-120` vs `shipmentController.ts:342-353`) |
| `fulfillment.status_changed` | `fulfillmentController.ts` (allocate 95, pick, pack, qc, ready 392) | sse (admin/warehouse board), audit | inline |

### 5.3 Returns & Refunds

| Event | Producer | Consumers | Currently |
|---|---|---|---|
| `return.requested` | `returnController.ts:97-103` | notification (admin alert — none today), audit, logistics (reverse pickup) | inline |
| `return.status_changed` | `returnController.ts` (approve 182, reject 209, receive 233, accept 302, reject-after-inspection 328, completed via webhook) | notification (`RETURN_*` templates exist, never fired), audit, sse | inline; **no email today** |
| `return.awaiting_refund` | accept-return (`returnController.ts:287-293`) | refundService (`refund.requested`), audit | sync Razorpay call |

### 5.4 Custom Printing & Production

| Event | Producer | Consumers | Currently |
|---|---|---|---|
| `print.job.created` | **new producer**: `payment.captured` consumer for custom line items — *replaces* the GET side-effect (`adminCustomOrderController.ts:57-64, 252-259`) | printService (create `PENDING_REVIEW` job), sse (production queue updates itself), audit | lazy GET side-effect |
| `print.job.status_changed` | `adminCustomOrderController.updatePrintJobStatus` (317-380), `adminProductionController` batch ops (158-198) | fulfillmentService (QC gate consumes state instead of inline read at `fulfillmentController.ts:316-330`), sse (production board), notification (customer "ready" milestone optional) | inline + polling |
| `production.export.requested` | `adminProductionController.batchExportPrintJobs` (201-292), `getPrintSheetExport` (`adminCustomOrderController.ts:418-481`) | **renderWorker** (CPU-bound ZIP/SVG generation off the request path) | synchronous in-request |

### 5.5 Support

| Event | Producer | Consumers | Currently |
|---|---|---|---|
| `support.ticket.created` | `supportController.ts:59-75` | notification (admin — none today), sse | REST only |
| `support.message_added` | customer `supportController.ts:141-182`, admin `adminSupportController.ts:180-225` | sse (`supportThreadUpdated` — replaces the 5s/10s `visibilitychange` pollers in `CustomerTicketDetailClient.tsx:139-143`, `AdminTicketDetailClient.tsx:145-149`, `AdminSupportQueueClient.tsx:82-86`), audit | polling |

### 5.6 Bulk Orders & Marketing

| Event | Producer | Consumers | Currently |
|---|---|---|---|
| `bulk.request.submitted` | `bulkOrderController.ts:132` | notification (sales/admin — none today) | none |
| `bulk.quote.sent` | `adminBulkOrderController.ts:149-150` ("sent" is nominal today — no email is sent) | notification (email the quote to customer) | no-op |
| `bulk.quote.accepted` | `bulkOrderController.acceptQuote` (206-297; three non-transactional writes) | orderService (create Order), notification | inline, not transactional |
| `campaign.due` (scheduled) | **scheduler worker** (new) for `Campaign.status === 'SCHEDULED'` (`adminCmsController.ts:266-296` toggles manually today; no cron exists) | campaignService (→ `ACTIVE`), sse (admin CMS) | manual only |

### 5.7 Cross-cutting

| Event | Producer | Consumers | Currently |
|---|---|---|---|
| `audit.logged` | a small `audit()` helper emitted by mutations | auditService (persist `AuditLog`; today there are 74 hand-written `AuditLog.create` call sites — a producer helper unifies actor/role/entity capture) | inline per controller |
| `analytics.event` | **new backend ingestion** `POST /api/analytics/events` + bus events | analyticsService → warehouse/GA4 server-side; closes the gap of #9 (client-only GA4 today) | client-only gtag |
| `webhook.received` / `webhook.processed` | both webhook controllers | observability ledger (event archaeology / replay source) | partial (`WebhookEvent`) |

---

## 6. Event Contracts (canonical examples)

Contracts are versioned; a schema (Zod, already used project-wide in `backend/src/utils/validation.ts`) is attached to each integration point.

```json
{
  "payment.captured": {
    "version": 1,
    "correlationId": "<#ref requestId/webhook event_id>",
    "aggregate": { "type": "Order", "id": "<orderId>" },
    "payload": {
      "orderId": "ObjectId",
      "orderNumber": "SF-1001",
      "razorpayOrderId": "order_...",
      "razorpayPaymentId": "pay_...",
      "currency": "INR",
      "total": 2499.00,
      "discount": 199.00,
      "items": [
        { "productId": "ObjectId", "variantId": "ObjectId", "quantity": 2,
          "unitPrice": 999, "customDesignId": "ObjectId|null",
          "printJobRequired": true }
      ],
      "customer": { "userId": "ObjectId", "email": "user@example.com" },
      "couponCode": "SAVE10|null"
    }
  },

  "shipment.status_changed": {
    "version": 1,
    "aggregate": { "type": "Shipment", "id": "<shipmentId>" },
    "payload": {
      "awbNumber": "DX12345678",
      "orderId": "ObjectId",
      "carrierStatus": "DEL",
      "internalStatus": "DELIVERED",
      "trackingHistory": [{ "status": "DELIVERED", "timestamp": "...", "location": "Mumbai" }]
    }
  },

  "print.job.status_changed": {
    "version": 1,
    "aggregate": { "type": "PrintJob", "id": "<printJobId>" },
    "payload": {
      "orderId": "ObjectId",
      "customDesignId": "ObjectId",
      "fromStatus": "PENDING_REVIEW",
      "toStatus": "READY_FOR_PRINT",
      "priority": "HIGH"
    }
  }
}
```

**Consumer contract rules**
- Consume at-least-once; dedupe with the event's `eventId` (mirrors `WebhookEvent.IGNORED→PROCESSED`, `webhookController.ts:34-49`).
- Never rely on delivery order across events; order within one aggregate is preserved via `occurredAt` cursor per aggregate where needed (e.g. shipment history).
- Commands (async actions like "send email", "call razorpay") live in workers; events only describe facts.

---

## 7. Non-Functional Requirements

### 7.1 Ordering
- **Per-aggregate ordering only.** Store a per-aggregate `sequence` in the envelope; consumers that need strict order (`logisticsWebhookController.ts` history appends, refund `refundedAmount` accumulation) process via the aggregate cursor.
- No global ordering guarantee (not needed for these domains).

### 7.2 Delivery semantics
- **At-least-once** everywhere. Consumers must be idempotent — the unique indexes the app already relies on (`models/WebhookEvent.ts:19`, `models/LogisticsEventLog.ts:12`, `models/NotificationLog.ts:37`, `models/InventoryTransaction.ts:32`, `models/Refund.ts:32`) are the precedent and the template.

### 7.3 Failure & retries
- Dispatcher retries `FAILED` deliveries with exponential backoff (`retryCount`, `nextAttemptAt`), cap ~5 attempts → dead-letter to `deferredEvents`.
- Webhook consumers additionally remain safe if the inbound provider redelivers (Razorpay `IGNORED` events are reprocessable because the dedupe guard at `webhookController.ts:36-49` only short-circuits on `PROCESSED`, and the record is flipped only after success at 205-210).

### 7.4 Security
- Domain event payloads are **internal only**; never expose outbox/bus endpoints publicly. The SSE gateway (Section 8) is the only read path to frontend clients and must be **authenticated** (reuse `requireAuth` JWT middleware, `backend/src/middleware/auth.ts`) with per-user subscription filtering (a user's events only — order/cart/support of that user; admin events for `ADMIN`/`SUPER_ADMIN` roles only).
- Keep the existing redaction utility (`observability.ts:9-48`) applied to any event payload logged/streamed.

### 7.5 Retention & replay
- Retain `events` for N days (config-driven) plus append-only; selectively persist raw inbound webhook bodies to `WebhookEvent`/`LogisticsEventLog` for replay (today they're dropped for Razorpay).

### 7.6 Observability
- Every event carries `producer.requestId` → correlation across REST + webhook + outbox + consumer (the plumbing already exists at `observability.ts:51-66`). Publish event-flow telemetry through the same structured logging middleware.

---

## 8. Frontend Integration (SSE, not sockets)

Use **Server-Sent Events** (`GET /api/events/stream`, `requireAuth`, `Accept: text/event-stream`):

| SSE event | Backend producer | Frontend consumer | Replaces |
|---|---|---|---|
| `orderUpdated` | `payment.captured`, `order.cancelled`, `refund.completed` | `useOrderStore.fetchOrder/fetchOrders` (`frontend/src/store/useOrderStore.ts:57,71`) | the 5s PENDING poller in `OrderConfirmationClient.tsx:33-38`; dead "Live Status" label in `OrderDetailsClient.tsx:203-247` |
| `shipmentUpdated` | `shipment.status_changed` | order detail tracking panel | pull-on-mount tracking |
| `cartUpdated` | cart writes | `useCartStore.fetchCart` (`useCartStore.ts:66`) | stale-cart shenanigans; also powers cross-device updates |
| `supportThreadUpdated` | `support.message_added` | `CustomerTicketDetailClient`, `AdminTicketDetailClient`, `AdminSupportQueueClient` | the three `visibilitychange` pollers (5s/5s/10s) |
| `productionQueueUpdated` | `print.job.status_changed` | admin production board | manual refresh |
| `adminAudit` (role-gated) | `audit.logged` | admin audit views | — |

Guidance:
- One long-lived connection per tab; auto-reconnect with `Last-Event-ID` (events have the `eventId` field for resume).
- Keep the existing optimistic pattern precedent (`useWishlistStore.ts:54-93`) — SSE refreshes are idempotent GETs that replace store state; no optimistic mutation needed.
- Client analytics events stay client-side GA4 (`frontend/src/lib/analytics.ts`); a future `POST /api/analytics/events` for backend-confirmed funnel events (`purchase`, `payment_failed`) is optional.

---

## 9. Migration Roadmap

### Phase 0 — Foundations (no behavior change)
- Add `DomainEvent` model + outbox helper + in-process `eventBus` registry + `OutboxDispatcher` poller (enabled only for audit events to prove the loop).
- Persist raw payloads on `WebhookEvent`/`LogisticsEventLog`.
- Extract the 74 inline `AuditLog.create` calls into one `audit()` producer emitting `audit.logged`.

### Phase 1 — Orders & Payments (highest ROI)
- Convert `processPaymentSuccess` (`paymentProcessor.ts:8-190`) into one transaction that mutates the order + writes `payment.captured`, then **consumers** perform inventory, coupon, cart, attempt/payment capture, and notification enqueue.
- Move the two in-request emails to the notification outbox (Section 4.4).
- Move `paymentProcessor` dispatch of `order.cancelled`/`refund.requested` out of the HTTP path (`orderController.ts:279-285`, `refundService.ts:80-84`) into the refund worker.
- Wire the six dead email templates (`notificationService.ts:140-153`) to events: `payment.failed`, `order.shipped`, `order.delivered`, `order.cancelled`, `refund.completed`, `return.*`.

### Phase 2 — Delivered-state propagation
- Publish `shipment.status_changed` from webhook + admin paths; centralize Order ripple in one consumer (removes the duplicated state logic in `logisticsWebhookController.ts:106-120` and `shipmentController.ts:342-353`).
- Move `print.job.created` producer to the `payment.captured` consumer (spot-fix the GET side-effect at `adminCustomOrderController.ts:57-64, 252-259`).

### Phase 3 — Realtime UX
- Add the SSE gateway + Next.js `EventStreamClient`; retire the four pollers.
- Add the scheduler worker for `campaign.due`.

### Phase 4 — Scale (optional, behind the same interfaces)
- Replace the DB polling dispatcher with BullMQ/Redis Streams consumers for `production.export.requested` (CPU-bound ZIP/SVG) and retry-heavy refund/email workers.
- Add per-consumer cursors or a light broker (Kafka/RabbitMQ) only if throughput grows beyond a single process.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Outbox adds latency before side effects run | Poll interval ~500ms; log-time visibility; ordering preserved per aggregate |
| Non-transactional writes (standalone Mongo fallback, `orderController.ts:155-172`, `acceptQuote` 3 writes) | Phase in transactions per-deployment; where impossible, keep idempotent consumers as the safety net (already the norm) |
| Double-delivery of webhook-derived events | Existing dedupe ledgers (`WebhookEvent`, `LogisticsEventLog`) + consumer `eventId` dedupe |
| Event schema drift | Versioned envelopes + Zod-validated payloads at the consumer boundary |
| SSE connection/churn load | One channel per user, reconnect with `Last-Event-ID`, keep REST as the source of truth |
| Developer ambiguity ("is this sync or async?") | Convention: HTTP request mutates aggregate + outbox only; all side effects are consumers |

---

## 11. Appendix — Existing Assets Worth Keeping (with evidence)

- **Idempotency primitives:** unique indexes already enforced — `models/WebhookEvent.ts:19`, `models/LogisticsEventLog.ts:12`, `models/NotificationLog.ts:37`, `models/InventoryTransaction.ts:32`, `models/Refund.ts:32`, `models/Order.ts:109`.
- **Correlation plumbing:** `requestIdMiddleware` stamps `x-request-id` (`backend/src/middleware/observability.ts:51-66`).
- **Secrets redaction:** `redactSecrets` (`observability.ts:9-48`).
- **Provider abstraction (good consumer pattern):** `logisticsService.ts` → `DelhiveryLogisticsProvider | MockLogisticsProvider`; same shape can host payment/email workers.
- **Notification outbox-in-waiting:** `NotificationLog` with `idempotencyKey` + `attemptCount` (`models/NotificationLog.ts:33-37`) — just stop awaiting the SMTP call.
- **Frontend state surface ready for invalidation:** all four data stores back onto idempotent GETs (`useCartStore.ts:66`, `useWishlistStore.ts:39`, `useOrderStore.ts:57,71`, `useAddressStore.ts:36`).
- **Auth plumbing for SSE:** `requireAuth`/`requireRole` (`backend/src/middleware/auth.ts`), plus the existing single custom frontend event pattern `auth-expired` (`frontend/src/lib/api.ts:92`).