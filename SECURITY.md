# Security

## Authentication

### JWT Token Architecture

The system uses a dual-token pattern:

| Token | Storage | Lifetime | Purpose |
|-------|---------|----------|---------|
| **Access Token** | localStorage | Short-lived | API authentication |
| **Refresh Token** | HTTP-only cookie | Long-lived | Obtain new access tokens |

**Flow:**
1. Login returns access token (in response body) + refresh token (in HTTP-only cookie)
2. Access token sent as `Authorization: Bearer <token>` header on protected requests
3. When access token expires (401 `TOKEN_EXPIRED`), frontend interceptor calls `POST /api/auth/refresh`
4. Refresh token verified against `Session` collection → new access token issued
5. If refresh token is invalid/expired → frontend dispatches `auth-expired` event → user redirected to login

### Token Signing

- **Access tokens** signed with `JWT_ACCESS_SECRET` (env variable, with hardcoded fallback `"fallback_access_secret"`)
- **Refresh tokens** signed with a separate secret
- Refresh tokens are stored as **hashes** in the `Session` collection (not plaintext)
- Sessions have TTL indexes — MongoDB auto-deletes expired documents
- Sessions track `lastUsedAt`, `userAgent`, and `ip` for audit

### Axios Interceptor (Token Refresh)

The frontend Axios instance (`src/lib/api.ts`) implements a request queue pattern:

1. Request interceptor attaches `Authorization: Bearer <token>` from localStorage
2. On 401 response where `originalRequest._retry` is falsy:
   - If a refresh is **already in progress**, the request is queued in a `failedQueue`
   - If **no refresh in progress**, POSTs to `/auth/refresh` (using raw axios, not the api instance)
   - On success: stores new token, drains queue with new token, replays original request
   - On failure: drains queue with error, removes token, dispatches `auth-expired` custom DOM event
3. SSR-safe: checks `typeof window !== "undefined"` before accessing localStorage

### Password Security

- Passwords hashed with **bcryptjs** before storage
- `passwordHash` field never returned in API responses
- Password requirements: min 8 chars, 1 uppercase, 1 lowercase, 1 digit
- Password reset tokens are single-use, time-limited, and stored as hashes
- Reset tokens auto-expire via MongoDB TTL indexes (`expireAfterSeconds: 0`)

---

## Authorization

### Role-Based Access Control (RBAC)

Three roles with ascending privileges:

```
CUSTOMER < ADMIN < SUPER_ADMIN
```

Two middleware functions compose the RBAC system:

1. **`requireAuth`** — Extracts JWT from `Authorization: Bearer <token>`, verifies signature using `JWT_ACCESS_SECRET`, attaches `{ id, role }` to `req.user`
2. **`requireRole(...roles)`** — Reads `req.user.role`, checks if it's in the allowed roles array. Returns 403 `FORBIDDEN` if not.

| Route Group | Middleware | Required Role |
|-------------|------------|---------------|
| `/api/auth/*` | Rate limiter only | None (public) |
| `/api/catalog/*` | None | None (public) |
| `/api/cart/*` | `requireAuth` | Any authenticated user |
| `/api/wishlist/*` | `requireAuth` | Any authenticated user |
| `/api/addresses/*` | `requireAuth` | Any authenticated user |
| `/api/orders/*` | `requireAuth` | Any authenticated user |
| `/api/payments/*` | `requireAuth` | Any authenticated user |
| `/api/shipping/*` | Mixed (below) | serviceability & rates: public; `/track/:idOrAwb`: `requireAuth` |
| `/api/admin/*` | `requireAuth` + `requireRole("ADMIN", "SUPER_ADMIN")` | ADMIN or SUPER_ADMIN |
| `/api/webhooks/*` | Signature verification | None (webhook) |

### Token Expiry Handling

- `TokenExpiredError` → 401 with code `TOKEN_EXPIRED`
- Other JWT errors → 401 with code `UNAUTHORIZED`
- Missing/malformed `Authorization` header → 401 with code `UNAUTHORIZED`

---

## Rate Limiting

| Scope | Limit | Window | Purpose |
|-------|-------|--------|---------|
| Auth routes (`/api/auth/register`, `/api/auth/login`) | 10 requests | 15 minutes | Brute-force prevention |
| Password reset (`/api/auth/forgot-password`, `/api/auth/reset-password`) | 3 requests | 60 minutes | Reset abuse prevention |

Applied via `express-rate-limit` middleware (`authLimiter` and `passwordResetLimiter`).

---

## Input Validation

All request inputs validated with **Zod** schemas:

- **Auth schemas** (`src/utils/validation.ts`): `registerSchema`, `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema`
- **Catalog schemas** (`src/utils/catalogValidation.ts`): `createCategorySchema`, `createThemeSchema`, `createProductSchema`, `inventoryAdjustmentSchema`, `catalogQuerySchema`, etc.
- Validation errors return 400 with code `VALIDATION_ERROR` and field-level detail

**Schema enforcement examples:**
- Slugs: lowercase + hyphens regex
- Hex codes: `/#([0-9a-fA-F]{3}){1,2}$/`
- ObjectIds: 24-char hex string
- Image URLs: valid URL format
- Inventory quantity: integer, cannot be 0
- Product discount: 0-100 range
- Product average rating: 0-5 range

---

## HTTP Security Headers

**Helmet.js** sets the following headers:

- `Content-Security-Policy` — Prevents XSS
- `X-Content-Type-Options: nosniff` — Prevents MIME sniffing
- `X-Frame-Options` — Prevents clickjacking
- `Strict-Transport-Security` — Enforces HTTPS
- `X-XSS-Protection` — Legacy XSS filter
- And others per Helmet defaults

---

## CORS Configuration

```typescript
cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true,  // Allow cookies
})
```

- Only the configured `FRONTEND_URL` can make cross-origin requests
- Credentials enabled to support HTTP-only cookie refresh tokens

---

## Payment Security

### Razorpay Integration

- Payment verification uses **HMAC-SHA256** signature verification
- Raw request body preserved for webhook signature verification (`express.raw()` mounted before `express.json()`)
- Webhook secret (`RAZORPAY_WEBHOOK_SECRET`) stored server-side only
- Razorpay API key ID sent to frontend for client-side checkout; secret stays server-side only

### Idempotency

- **Webhook events** deduplicated by `{ provider, eventId }` compound unique index
- **Order creation** uses `idempotencyKey` field with partial unique index to prevent duplicate orders
- **Inventory SALE transactions** use compound unique index `{ orderId, variantId, type }` to prevent double stock deduction
- **Payment** has unique index on `orderId` (one payment per order)
- **Shipment** has unique index on `orderId` (one shipment per order)

---

## Delhivery / Shipping Security

### Credential Handling

- **Never commit `DELHIVERY_API_TOKEN`** (or any Delhivery credential). Real values live only in untracked `.env` files (`.gitignore` excludes `.env` / `.env.*`).
- **Never commit webhook secrets** (e.g., an application-level `DELHIVERY_WEBHOOK_SECRET` / `LOGISTICS_WEBHOOK_SECRET`).
- **Never expose Delhivery API tokens to frontend JavaScript.** The token is used server-side only, as an `Authorization: Token <token>` header on Delhivery API calls.
- **Delhivery API calls must happen server-side** — the frontend never calls Delhivery directly.

### Environment Separation

- Keep **staging** and **production** Delhivery credentials strictly separate. `DELHIVERY_ENV=sandbox` is an application-level label that maps to Delhivery's **staging** environment; it must not be used as a production flag. A staging token must never be used (or documented) as a production token.

### Webhook Security

- **Validate webhook requests according to the actual mechanism implemented by the project.** The `POST /api/webhooks/logistics` handler verifies an HMAC-SHA256 digest over the raw request body against an **application-level** shared secret (`DELHIVERY_WEBHOOK_SECRET` or `LOGISTICS_WEBHOOK_SECRET`). This is an **application-level shared secret, not a secret supplied by Delhivery** — treat it accordingly and keep it out of version control.
- The raw body is required for signature verification (`express.raw()` is mounted before `express.json()` for webhook routes).
- **Never trust webhook payloads blindly** — always validate the signature, and handle malformed/incomplete payloads (e.g., missing AWB/status) as errors.
- **Validate the AWB/order relationship before updating an order** — a webhook should only update the shipment that matches the provided AWB, and order status should be synchronized only for that matched shipment.
- **Make webhook processing idempotent** — events are deduplicated by the unique `LogisticsEventLog.providerEventId` index, so duplicates are ignored.

### Shipment / Order Integrity

- **Prevent duplicate shipment creation** — `Shipment.orderId` has a unique index (one shipment per order), and the controller returns the existing shipment rather than creating a duplicate.
- **Validate order, address, PIN, weight, payment mode, and order data before shipment creation** — shipment creation is restricted to orders in `CONFIRMED` or `PROCESSING` status with a valid shipping address and package details.

### Endpoint Protection

- **Apply authentication/authorization to internal shipping/admin endpoints** — all `/api/admin/orders/:id/shipment*` routes require `requireAuth` + `requireRole("ADMIN", "SUPER_ADMIN")`. Customer tracking (`/api/shipping/track/:idOrAwb`) is scoped to the authenticated customer's own shipments.

### Logging & Error Handling

- **Log useful API errors** (operation, status, message) but **never log authentication tokens or secrets** (e.g., Delhivery API token, webhook secret).
- **Redact sensitive information from logs** — do not log full webhook signatures, tokens, or credentials.

### Transport

- **Use HTTPS in production** for all traffic, including Delhivery API communication and the logistics webhook endpoint. (Like the rest of the app, HTTPS is typically terminated at a reverse proxy.)

---

## Data Protection

- Passwords and tokens **never stored in plaintext** — always hashed
- Refresh tokens stored as hashes in `Session` collection
- Password reset tokens stored as hashes with TTL auto-expiry
- `passwordHash` field excluded from API responses
- Address data is **snapshotted** at order time (immutable `OrderAddress` in the order document)
- Audit logs track all admin actions (`actorId`, `actorRole`, `action`, `entityType`, `entityId`)
- Sessions track `lastUsedAt`, `userAgent`, and `ip` for session auditing

---

## Error Handling

- **Production mode:** Generic error messages for 500 errors; no logging
- **Development mode:** 5xx errors logged with `console.error` (full stack); 4xx AppErrors logged with `console.warn`
- **No stack traces** exposed to the client in any environment
- **Consistent error format:** `{ success: false, message, code, errors }`
- **Mongoose validation errors** caught and returned as 400 with code `MONGO_VALIDATION_ERROR`
- **Zod errors** caught and returned as 400 with code `VALIDATION_ERROR` with field-level details

---

## Known Security Considerations

1. **JWT secret fallback:** `JWT_ACCESS_SECRET` has a hardcoded fallback `"fallback_access_secret"` — must be overridden in production
2. **Session invalidation:** Refresh tokens are individually revoked on logout. No global "logout all devices" feature exists yet.
3. **Email service:** Currently uses console logging (dev mode). Production should use a real email service with TLS.
4. **HTTPS:** Not enforced at the application level — must be handled by reverse proxy (nginx, etc.) in production.
5. **MongoDB authentication:** Local development uses unauthenticated MongoDB. Production must enable authentication and TLS.
6. **File uploads:** Product images are referenced as URLs. No built-in upload validation — assume trusted sources or add validation before production.
7. **Rate limiting:** Only applied to auth routes. Consider adding rate limiting to other sensitive endpoints (order creation, payment) in production.
