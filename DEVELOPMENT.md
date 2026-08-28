# Development Guide

## Prerequisites

- **Node.js** v18+ (recommended: v20 LTS)
- **MongoDB** running locally on port 27017
- **Razorpay** test account (register at https://dashboard.razorpay.com)
- **Git**

---

## Setup

### Backend

```bash
cd backend
npm install

# Seed the admin user (email: admin@samratfashion.com, password: password123)
node seed-admin.js

# Start dev server (port 5000)
npm run dev
```

### Frontend

```bash
cd frontend
npm install

# Start dev server (port 3000)
npm run dev
```

### MongoDB

Ensure MongoDB is running locally:

```bash
# Windows
net start MongoDB

# macOS (Homebrew)
brew services start mongodb-community

# Linux
sudo systemctl start mongod
```

The database `samrat_fashion` is created automatically on first connection.

---

## Environment Variables

### Shared frontend and backend (`.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5000` | Server port |
| `MONGODB_URI` | No | `mongodb://localhost:27017/samrat_fashion` | MongoDB connection string |
| `FRONTEND_URL` | No | `http://localhost:3000` | CORS allowed origin |
| `JWT_ACCESS_SECRET` | Yes | `fallback_access_secret` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Yes | — | Refresh token signing secret |
| `RAZORPAY_KEY_ID` | Yes | — | Razorpay API key |
| `RAZORPAY_KEY_SECRET` | Yes | — | Razorpay API secret |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | — | Razorpay webhook signature secret |

### Delhivery / Logistics (`.env`)

Only example/placeholder values — never commit real credentials.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOGISTICS_PROVIDER` | No | `mock` | `delhivery` (real integration) or `mock` (development) |
| `ALLOW_LOGISTICS_MOCK` | No | — | Set `true` to allow the mock provider in staging/production |
| `DELHIVERY_ENV` | No | `sandbox` | Application-level label; `sandbox` maps to Delhivery's staging/test environment |
| `DELHIVERY_API_TOKEN` | Yes (if `delhivery`) | — | Delhivery API token for the target environment (staging or production) |
| `DELHIVERY_CLIENT_NAME` | No | `SAMRAT FASHION` | Registered Delhivery client/account name |
| `DELHIVERY_PICKUP_LOCATION` | No | `Primary Warehouse` | Registered pickup location name |
| `DELHIVERY_WEBHOOK_SECRET` | No | dev fallback | Application-level shared secret for logistics webhook signature verification |
| `ORIGIN_POSTAL_CODE` | No | `400001` | Warehouse / pickup location PIN code |
| `DELHIVERY_SANDBOX_URL` | No | `https://staging-express.delhivery.com` | Staging base URL override |
| `DELHIVERY_BASE_URL` | No | `https://track.delhivery.com` | Production base URL override |

**Important:** The code reads `JWT_ACCESS_SECRET` (not `JWT_SECRET`). The auth middleware and auth controller both use `process.env.JWT_ACCESS_SECRET`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:5000/api` | Backend API base URL |

---

## Scripts Reference

### Backend (`backend/`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start dev server with hot reload (ts-node-dev) |
| `build` | `npm run build` | Compile TypeScript to `dist/` |
| `start` | `npm start` | Run production build |
| `seed` | `node seed-admin.js` | Create/reset admin user |
| `get-admin` | `node get-admin.js` | Print admin user info |

### Frontend (`frontend/`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start Next.js dev server |
| `build` | `npm run build` | Production build |
| `start` | `npm start` | Serve production build |
| `lint` | `npm run lint` | Run ESLint |

---

## Coding Conventions

### Backend

- **Language:** TypeScript (strict mode, CommonJS modules)
- **Error handling:** Wrap all async controllers with `catchAsync()`, throw `AppError` for operational errors
- **Validation:** Use Zod schemas defined in `utils/validation.ts` (auth) and `utils/catalogValidation.ts` (catalog/admin)
- **Response format:** Always return `{ success, message, code, errors, data? }`
- **Route naming:** Kebab-case for routes (`/api/cart/items`), camelCase for code
- **Model naming:** PascalCase files (`Product.ts`, `CartItem.ts`)
- **Controller naming:** camelCase files with `Controller` suffix (`cartController.ts`)
- **Middleware:** `requireAuth` for JWT verification, `requireRole(...)` for RBAC

### Frontend

- **Language:** TypeScript (strict mode, bundler module resolution)
- **Components:** Functional components with `"use client"` directive when needed
- **State:** Zustand stores in `src/store/` — one per domain
- **Forms:** React Hook Form + Zod validation
- **Styling:** Tailwind CSS classes; design tokens in `globals.css`
- **Path aliases:** `@/` maps to `src/`
- **Component organization:** Domain-based folders under `components/`
- **Naming:** PascalCase for components (`ProductCard.tsx`), camelCase for hooks/stores
- **API client:** Use `src/lib/api.ts` (Axios instance with auto token refresh)

---

## Adding a New Feature

### Backend (new endpoint)

1. Create/update Mongoose model in `src/models/`
2. Create Zod validation schema in `src/utils/`
3. Create controller in `src/controllers/` (wrap async functions with `catchAsync`)
4. Create route file in `src/routes/`
5. Mount route in `src/index.ts`

### Frontend (new page)

1. Create page component in `src/app/(storefront)/` or `src/app/(admin)/`
2. Create client component in `src/components/` if interactive (add `"use client"`)
3. Create Zustand store in `src/store/` if stateful
4. Use Axios client (`lib/api.ts`) for API calls — it handles token refresh automatically

---

## Testing the API

Use the provided test script:

```bash
cd backend
node test-api.js
```

Or test manually with curl:

```bash
# Health check
curl http://localhost:5000/api/health

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@samratfashion.com","password":"password123"}'

# Get catalog
curl http://localhost:5000/api/catalog/products
```

---

## Production Build

### Backend

```bash
cd backend
npm run build    # Compiles to dist/
npm start        # Runs dist/index.js with Node.js
```

### Frontend

```bash
cd frontend
npm run build    # Next.js production build
npm start        # Serves on port 3000
```

---

## Delhivery Development & Testing

This section explains how to configure and test the Delhivery shipping integration locally.

### 1. Environment Variables

Configure the logistics/delivery vars in `backend/.env` (values are placeholders — do not commit real credentials):

```env
LOGISTICS_PROVIDER=delhivery          # 'delhivery' for the real integration, 'mock' for development
ALLOW_LOGISTICS_MOCK=true             # allow the mock provider in non-production while testing
DELHIVERY_ENV=sandbox                 # application-level label → maps to Delhivery staging
DELHIVERY_API_TOKEN=<staging-token>   # token for the environment being tested
DELHIVERY_CLIENT_NAME=<registered-client-name>
DELHIVERY_PICKUP_LOCATION=<registered-pickup-location>
ORIGIN_POSTAL_CODE=<warehouse-pincode>
DELHIVERY_WEBHOOK_SECRET=<app-level-webhook-secret>
```

### 2. Staging / Testing Environment

- Set `DELHIVERY_ENV=sandbox`. This is an application-level label that maps to Delhivery's **staging** environment (base URL `https://staging-express.delhivery.com` by default).
- Use the appropriate **staging** API token in `DELHIVERY_API_TOKEN`.
- Staging is useful for verifying request/response shapes, AWB assignment, serviceability, and rate calculations without affecting live shipments.

### 3. Production Environment

- Set `DELHIVERY_ENV` to a non-`sandbox` value (or leave it unset) so the provider targets the Delhivery **production** base URL (`https://track.delhivery.com` by default).
- Use the **production** API token — never reuse a staging token as if it were a production token.
- The backend enforces that mock logistics is disabled in production/staging unless `ALLOW_LOGISTICS_MOCK=true`.

### 4. How to Obtain Credentials

- The **Delhivery Developer Portal** can be used to execute/test supported APIs, but **application-level staging credentials should be obtained through the appropriate Delhivery account / Business POC process when required.**
- A staging/testing API token **cannot** be generated from the normal API Setup page — it must be requested through your Delhivery Business Account / POC if required.
- Do not invent or guess tokens. Keep staging and production tokens strictly separate.

### 5. Avoiding Committing Credentials

- Never commit `DELHIVERY_API_TOKEN`, `DELHIVERY_WEBHOOK_SECRET`, or any real Delhivery credential.
- The repo's `.gitignore` excludes `.env` and `.env.*` (whitelisting only `.env.example` / `.env.*.example`). Keep real values only in untracked `.env` files.
- Do not paste tokens into documentation, comments, or commit messages.

### 6. Local Webhook Testing

- Use a local tunnel (e.g., ngrok) to expose your backend to Delhivery, or simulate webhooks locally by `POST`ing directly to `http://localhost:5000/api/webhooks/logistics`.
- Compute the `x-logistics-signature` HMAC-SHA256 over the **raw** JSON body using your app-level `DELHIVERY_WEBHOOK_SECRET`, or disable the signature requirement in development when appropriate (the handler only enforces the signature in production or when a signature header is present).
- Confirm duplicate events are ignored (idempotent via `LogisticsEventLog.providerEventId`).

### 7. Testing Order Creation

- Create an order via `POST /api/orders` (requires auth) with an `addressId`.
- Complete payment via `POST /api/payments/create-order` + `POST /api/payments/verify` so the order reaches `CONFIRMED` / `paymentStatus: PAID`.
- Verify the order status allows shipment creation (`CONFIRMED` or `PROCESSING`).

### 8. Testing Shipment Creation

- As an admin, call `POST /api/admin/orders/:id/shipment` (optionally with `weightGrams`/package dimensions).
- Verify `Shipment` is created with status `LABEL_CREATED` and an AWB returned by the provider.
- With `LOGISTICS_PROVIDER=mock`, the mock provider returns a synthetic AWB; with `delhivery`, a real staging AWB is returned.
- Confirm idempotency — calling it again returns the existing shipment rather than creating a duplicate.

### 9. Testing AWB Storage

- After shipment creation, confirm the AWB is stored as `Shipment.awbNumber` (and mirrored in `trackingNumber`), associated with `Shipment.orderId`.

### 10. Testing Tracking

- Use `GET /api/shipping/track/:idOrAwb` (customer, authenticated) to retrieve tracking for an order, shipment ID, AWB, or tracking number.
- As admin, call `POST /api/admin/orders/:id/shipment/tracking/refresh` to pull/append the latest provider tracking events.

### 11. Testing Webhook Updates

- Send a `POST /api/webhooks/logistics` with a valid AWB and a status (e.g., `IN_TRANSIT` → order becomes `SHIPPED`; `DELIVERED` → order becomes `DELIVERED`).
- Verify the shipment `status` and `trackingHistory` update and that the order status synchronizes.
- Re-send the same `providerEventId` and confirm it is ignored (idempotent).

### 12. Failure / Retry Testing

- Remove/invalidate `DELHIVERY_API_TOKEN` and confirm provider calls fail with a `LOGISTICS_CONFIG_ERROR` (message indicating the token is not configured).
- Point `DELHIVERY_BASE_URL`/`DELHIVERY_SANDBOX_URL` to an unreachable host and confirm a provider error code is returned (e.g., `LOGISTICS_PROVIDER_ERROR`).
- Confirm that a failed courier call does **not** corrupt the order — a paid order should not fail solely because the courier API is temporarily down. Shipment creation should be retryable and idempotent (a retry must not create a second shipment/AWB).
- Verify that **staging** results, especially shipping-cost calculations, should **not** automatically be treated as production pricing.

---

## Common Issues

| Issue | Solution |
|-------|----------|
| `MongoNetworkError` | Ensure MongoDB is running on port 27017 |
| `CORS error` | Check `FRONTEND_URL` in backend `.env` matches frontend URL |
| `JWT expired` / 401 on valid token | Frontend auto-refreshes; check refresh token cookie is being set (`withCredentials: true`) |
| `401 UNAUTHORIZED` on admin routes | Ensure logged in as ADMIN or SUPER_ADMIN role |
| `403 FORBIDDEN` | User role doesn't match required role for the endpoint |
| Port conflict | Change `PORT` in backend `.env` or `--port` flag for Next.js |
| `JWT_ACCESS_SECRET` undefined | Set `JWT_ACCESS_SECRET` in backend `.env` (the code reads this, not `JWT_SECRET`) |
| Admin login redirect loop | Check admin layout role protection; ensure `AuthProvider` fetches `/auth/me` on mount |
