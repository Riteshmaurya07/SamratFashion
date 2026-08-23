# Architecture

## System Overview

THREADVIBE is a monorepo with two independent applications sharing a MongoDB database:

```
┌──────────────┐       HTTP/REST        ┌──────────────┐       Mongoose       ┌──────────┐
│   Frontend   │ ◄──────────────────────► │   Backend    │ ◄───────────────────► │ MongoDB  │
│  Next.js 16  │   localhost:3000        │  Express.js 5│   localhost:5000      │ :27017   │
│              │                         │              │                       │          │
└──────────────┘                         └──────┬───────┘                       └──────────┘
                                                │
                                         ┌──────▼───────┐
                                         │   Razorpay   │
                                         │  Payment API  │
                                         └──────────────┘
```

---

## Backend Architecture

### Request Flow

```
Client Request
     │
     ▼
  Helmet (security headers)
     │
     ▼
  CORS (origin validation)
     │
     ▼
  express.raw() — /api/webhooks only (Razorpay signature verification)
     │
     ▼
  express.json() — body parsing
     │
     ▼
  cookie-parser
     │
     ▼
  Route Handler
     │
     ├─► Auth Middleware (requireAuth + requireRole) — protected routes
     │
     ├─► Zod Validation (request body/params/query)
     │
     ├─► Controller (business logic, wrapped with catchAsync)
     │     │
     │     ├─► Mongoose Model (DB query)
     │     │
     │     └─► Service Layer (RazorpayProvider, emailService, refundService)
     │
     └─► Response
           │
           ▼
     Global Error Handler (AppError / ZodError / MongooseValidationError)
```

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|---------------|
| **Routes** | `src/routes/` | HTTP verb + path mapping, middleware chaining |
| **Middleware** | `src/middleware/` | JWT auth (`requireAuth`), role guards (`requireRole`), global error handling |
| **Controllers** | `src/controllers/` | Business logic, request/response orchestration |
| **Models** | `src/models/` | Mongoose schemas, indexes, embedded subdocuments |
| **Services** | `src/services/` | External integrations (Razorpay, email) |
| **Utils** | `src/utils/` | Shared helpers (AppError, catchAsync, Zod validation schemas) |
| **Config** | `src/config/` | Database connection setup |

### Key Patterns

**Async Error Handling:**
Every controller is wrapped with `catchAsync()` — catches rejected promises and forwards them to `next()`. No `try/catch` blocks in controllers.

**Custom Error Class (`AppError`):**
All operational errors thrown as `AppError` with HTTP status code, machine-readable error code (e.g., `NOT_FOUND`, `UNAUTHORIZED`, `TOKEN_EXPIRED`), and user-facing message.

**Global Error Handler (`errorHandler`):**
Catches all errors and returns consistent `{ success: false, message, code, errors }`:
- `AppError` → extracts status code and error code
- `ZodError` → 400 with field-level details
- `Mongoose ValidationError` → 400 with validation message
- Unknown errors → 500 (no stack trace exposed to client)

**Zod Validation:**
Request validation via `src/utils/validation.ts` (auth) and `src/utils/catalogValidation.ts` (catalog/admin). Invalid requests return 400 with `VALIDATION_ERROR`.

**Admin Audit:**
Admin actions are logged in `AuditLog` with `actorId`, `actorRole`, `action`, `entityType`, `entityId`, and optional `metadata`.

---

## Frontend Architecture

### Routing (Next.js App Router)

Uses **route groups** to isolate layouts without affecting URLs:

```
app/
├── (storefront)/        → Customer layout (Navbar + Footer)
│   ├── page.tsx         → Homepage (/)
│   ├── shop/            → Product listing (/shop) & detail (/shop/:slug)
│   ├── cart/            → Cart (/cart)
│   ├── checkout/        → Checkout (/checkout)
│   ├── order-confirmation/[id]/ → Confirmation (/order-confirmation/:id)
│   └── account/         → Orders, wishlist, addresses
│       ├── orders/      → /account/orders & /account/orders/:id
│       ├── wishlist/    → /account/wishlist
│       └── addresses/   → /account/addresses
│
├── (auth)/              → Minimal layout
│   ├── login/           → /login
│   ├── register/        → /register
│   ├── forgot-password/ → /forgot-password
│   ├── reset-password/  → /reset-password
│   └── admin/login/     → /admin/login (separate admin login)
│
└── (admin)/             → Admin layout (sidebar + header, role-protected)
    └── admin/
        ├── page.tsx                 → Dashboard (/admin)
        ├── products/                → /admin/products, /admin/products/new, /admin/products/:id/edit, /admin/products/:id/inventory
        ├── categories/              → /admin/categories
        ├── themes/                  → /admin/themes
        ├── orders/                  → /admin/orders & /admin/orders/:id
        ├── customers/               → /admin/customers & /admin/customers/:id
        ├── returns/                 → /admin/returns & /admin/returns/:id
        └── inventory/               → /admin/inventory
```

### Server vs Client Components

- **Server Components** (default): Homepage, shop listing — SSR for SEO
- **Client Components** (`"use client"`): All interactive pages — cart, checkout, admin CRUD, modals
- **Loading states:** `loading.tsx` files in `(storefront)/` and `shop/` for Suspense boundaries
- **Error boundary:** `error.tsx` in `(storefront)/`

### State Management (Zustand)

Each domain has its own Zustand store with built-in API calls:

| Store | File | Purpose |
|-------|------|---------|
| `useAuthStore` | `useAuthStore.ts` | User state (`user`, `isAuthenticated`, `isLoading`), `setUser`, `logout` — no API calls (set by AuthProvider) |
| `useCartStore` | `useCartStore.ts` | Cart items, summary, `fetchCart`, `addItem`, `updateQuantity`, `removeItem`, `clearCart` |
| `useOrderStore` | `useOrderStore.ts` | Orders list, current order, `fetchOrders`, `fetchOrder`, `createOrder`, `cancelOrder` |
| `useWishlistStore` | `useWishlistStore.ts` | Wishlist items, `fetchWishlist`, `toggleWishlist`, `removeItem`, `clearWishlist`, `isInWishlist` |
| `useAddressStore` | `useAddressStore.ts` | Addresses list, `fetchAddresses`, `createAddress`, `updateAddress`, `deleteAddress`, `setDefaultAddress` |

### Axios Interceptor (Token Refresh)

```
Request → Attach Authorization header from localStorage
     │
     ▼
  Response OK → Return
  Response 401 → Is refresh already in progress?
     │
     ├─ Yes → Queue request in failedQueue
     │
     └─ No → POST /auth/refresh (raw axios, withCredentials)
              │
              ├─ Success → Store new token, drain queue, retry request
              │
              └─ Failure → Drain queue with error, clear token,
                           dispatch 'auth-expired' event
```

The interceptor uses a request queue (`failedQueue` array of `{ resolve, reject }`) to prevent multiple simultaneous refresh attempts.

---

## Data Flow Examples

### Add to Cart

```
1. User clicks "Add to Cart" on PDP
2. useCartStore.addItem(productId, variantId, quantity)
3. Axios POST /api/cart/items { productId, variantId, quantity }
4. Auth middleware verifies JWT via requireAuth
5. Cart controller finds or creates user cart (unique on userId)
6. Validates product/variant exists and stock > 0
7. Updates cart document (items array)
8. Returns updated cart with populated items and summary
9. Zustand store updates → UI re-renders with new cart count
```

### Order + Payment Flow

```
1. User clicks "Place Order" on checkout
2. POST /api/orders { addressId, idempotencyKey? }
   → Creates order (status: PENDING, paymentStatus: PENDING)
   → Snapshots address into shippingAddress
   → Snapshots product details into OrderItem (name, image, size, color, unitPrice, lineTotal)
3. POST /api/payments/create-order { orderId }
   → Creates Razorpay order (amount in paise)
   → Creates Payment record (orderId unique)
   → Creates PaymentAttempt record
   → Returns { razorpayOrderId, amount, currency, key }
<!-- 4. Frontend opens Razorpay checkout modal -->
5. User completes payment
6. POST /api/payments/verify { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId }
   → Verifies HMAC-SHA256 signature
   → Order status → CONFIRMED, paymentStatus → PAID
   → PaymentAttempt status → CAPTURED
7. Redirect to /order-confirmation/:id
```

### Return + Refund Flow

```
1. Customer submits: POST /api/orders/:id/returns { items, customerNote }
   → Status: REQUESTED
2. Admin reviews: POST /api/admin/returns/:id/approve { adminNote }
   → Status: APPROVED
3. Customer ships item back
4. Admin receives: POST /api/admin/returns/:id/receive
   → Status: RECEIVED
5. Admin inspects: POST /api/admin/returns/:id/inspect
   → Status: INSPECTING
6a. Admin accepts: POST /api/admin/returns/:id/accept
    → Status: ACCEPTED
6b. OR Admin rejects: POST /api/admin/returns/:id/reject-after-inspection { adminNote }
    → Status: REJECTED_AFTER_INSPECTION
7. Admin initiates refund: POST /api/admin/orders/:id/refund { amount, reason }
   → Creates Refund record (PENDING)
   → Razorpay refund API called
   → Refund status → PROCESSED
   → InventoryTransaction created (type: RETURN or REFUND)
```

---

## File Organization Conventions

- One model per file, PascalCase: `Product.ts`, `CartItem.ts`
- One controller per domain: `cartController.ts`, `orderController.ts`
- Routes map HTTP verbs to controller methods with middleware chains
- Validation schemas grouped by domain: `validation.ts` (auth), `catalogValidation.ts` (catalog/admin)
- Services encapsulate external API calls: `RazorpayProvider.ts`, `emailService.ts`
- Frontend: one component per file, co-located in domain folders under `components/`
- Zustand stores: one per domain, `use{Domain}Store.ts`
- Route groups in Next.js: `(storefront)`, `(auth)`, `(admin)` — no URL segments
