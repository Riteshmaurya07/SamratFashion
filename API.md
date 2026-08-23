# API Reference

Base URL: `http://localhost:5000/api`

All responses follow the format:
```json
{
  "success": true | false,
  "message": "Description",
  "code": "ERROR_CODE",
  "errors": [],
  "data": { ... }
}
```

---

## Health Check

### `GET /api/health`

Check server status.

**Response (200):**
```json
{
  "success": true,
  "message": "Server is healthy",
  "code": "SUCCESS",
  "errors": []
}
```

---

## Auth Routes

| Method | Route | Rate Limit | Auth | Description |
|--------|-------|-----------|------|-------------|
| POST | `/api/auth/register` | 10 req/15min | Public | Register new customer |
| POST | `/api/auth/login` | 10 req/15min | Public | Login |
| POST | `/api/auth/refresh` | None | Public | Refresh access token |
| POST | `/api/auth/logout` | None | Public | Logout (invalidate session) |
| GET | `/api/auth/me` | None | Required | Get current user |
| POST | `/api/auth/forgot-password` | 3 req/hr | Public | Request password reset |
| POST | `/api/auth/reset-password` | 3 req/hr | Public | Reset password with token |

### `POST /api/auth/register`

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "password": "SecurePass123"
}
```

Password must have: min 8 chars, 1 uppercase, 1 lowercase, 1 digit.

### `POST /api/auth/login`

**Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Response:** Sets refresh token as HTTP-only cookie. Returns access token in body.

### `POST /api/auth/refresh`

Uses the refresh token from HTTP-only cookie. Returns new access token.

### `POST /api/auth/logout`

**Auth:** Required (but works without — clears cookie regardless)

### `GET /api/auth/me`

**Auth:** Required (`Authorization: Bearer <token>`)

### `POST /api/auth/forgot-password`

**Body:** `{ "email": "john@example.com" }`

### `POST /api/auth/reset-password`

**Body:**
```json
{
  "token": "reset_token_from_email",
  "newPassword": "NewSecurePass123"
}
```

---

## Catalog Routes (Public)

All catalog routes are public — no authentication required.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/catalog/homepage` | Homepage aggregation (trending products) |
| GET | `/api/catalog/categories` | List all categories |
| GET | `/api/catalog/categories/:slug` | Category by slug |
| GET | `/api/catalog/themes` | List all themes |
| GET | `/api/catalog/themes/:slug` | Theme by slug |
| GET | `/api/catalog/products` | List products with filters |
| GET | `/api/catalog/products/:slug` | Product by slug |

### `GET /api/catalog/products`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page |
| `q` | string | Text search |
| `category` | string | Filter by category slug |
| `theme` | string | Filter by theme slug |
| `sort` | string | `newest`, `price_asc`, `price_desc`, `relevance` |

---

## Cart Routes

All cart routes require authentication. Auth middleware is applied to the entire router.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/cart` | Get user's cart |
| POST | `/api/cart/items` | Add item to cart |
| PATCH | `/api/cart/items/:itemId` | Update item quantity (`itemId` format: `productId_variantId`) |
| DELETE | `/api/cart/items/:itemId` | Remove item from cart (`itemId` format: `productId_variantId`) |
| DELETE | `/api/cart` | Clear entire cart |

### `POST /api/cart/items`

**Body:**
```json
{
  "productId": "...",
  "variantId": "...",
  "quantity": 1
}
```

### `PATCH /api/cart/items/:itemId`

**Path param:** `:itemId` = `productId_variantId` (e.g. `65f1234_65f5678`)

**Body:**
```json
{
  "quantity": 3
}
```

### `DELETE /api/cart/items/:itemId`

**Path param:** `:itemId` = `productId_variantId` (e.g. `65f1234_65f5678`)

---

## Wishlist Routes

All wishlist routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/wishlist` | Get user's wishlist |
| POST | `/api/wishlist/items/:productId` | Add product to wishlist |
| DELETE | `/api/wishlist/items/:productId` | Remove product from wishlist |
| DELETE | `/api/wishlist` | Clear entire wishlist |

---

## Address Routes

All address routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/addresses` | List user's addresses |
| POST | `/api/addresses` | Create new address |
| GET | `/api/addresses/:id` | Get address by ID |
| PUT | `/api/addresses/:id` | Update address |
| DELETE | `/api/addresses/:id` | Delete address |
| PATCH | `/api/addresses/:id/default` | Set address as default |

### `POST /api/addresses`

**Body:**
```json
{
  "fullName": "John Doe",
  "phone": "9876543210",
  "addressLine1": "123 Main Street",
  "addressLine2": "Apt 4B",
  "city": "Mumbai",
  "state": "Maharashtra",
  "postalCode": "400001",
  "country": "India",
  "landmark": "Near Station",
  "addressType": "HOME",
  "isDefault": true
}
```

---

## Order Routes

All order routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/orders` | List user's orders |
| POST | `/api/orders` | Create order from cart |
| GET | `/api/orders/returns` | List user's return requests |
| GET | `/api/orders/:id` | Get order detail |
| POST | `/api/orders/:id/cancel` | Cancel order |
| POST | `/api/orders/:id/returns` | Submit return request |
| GET | `/api/orders/:id/returns` | List returns for order |
| GET | `/api/orders/:id/returns/:returnId` | Get return detail |
| POST | `/api/orders/:id/returns/:returnId/cancel` | Cancel return request |

### `POST /api/orders`

**Body:**
```json
{
  "addressId": "...",
  "idempotencyKey": "optional-unique-key"
}
```

### `POST /api/orders/:id/returns`

**Body:**
```json
{
  "items": [
    {
      "productId": "...",
      "variantId": "...",
      "quantity": 1,
      "reason": "WRONG_SIZE",
      "description": "Ordered M, received L"
    }
  ],
  "customerNote": "Please process quickly"
}
```

**Return reasons:** `WRONG_SIZE`, `WRONG_PRODUCT`, `DAMAGED`, `DEFECTIVE`, `NOT_AS_DESCRIBED`, `OTHER`

---

## Payment Routes

All payment routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/payments/create-order` | Create Razorpay order |
| POST | `/api/payments/verify` | Verify payment signature |
| GET | `/api/payments/order/:orderId` | Get payment status |

### `POST /api/payments/create-order`

**Body:** `{ "orderId": "..." }`

**Response:**
```json
{
  "data": {
    "razorpayOrderId": "order_xxx",
    "amount": 89900,
    "currency": "INR",
    "key": "rzp_test_xxx"
  }
}
```

### `POST /api/payments/verify`

**Body:**
```json
{
  "razorpayOrderId": "order_xxx",
  "razorpayPaymentId": "pay_xxx",
  "razorpaySignature": "signature_xxx",
  "orderId": "internal_order_id"
}
```

---

## Admin Routes

All admin routes require `ADMIN` or `SUPER_ADMIN` role. Two routers are mounted at `/api/admin`:

- `adminCatalogRoutes` — catalog management (products, categories, themes, inventory)
- `adminRoutes` — operations (dashboard, orders, returns, refunds, shipments, customers)

### Dashboard

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/dashboard` | Dashboard KPIs (revenue, order counts, low stock) |

### Categories (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/categories` | List all categories (incl. inactive) |
| POST | `/api/admin/categories` | Create category |
| GET | `/api/admin/categories/:id` | Get category by ID |
| PUT | `/api/admin/categories/:id` | Update category |
| PATCH | `/api/admin/categories/:id/status` | Toggle category status |

### Themes (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/themes` | List all themes (incl. inactive) |
| POST | `/api/admin/themes` | Create theme |
| GET | `/api/admin/themes/:id` | Get theme by ID |
| PUT | `/api/admin/themes/:id` | Update theme |
| PATCH | `/api/admin/themes/:id/status` | Toggle theme status |

### Products (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/products` | List all products (incl. drafts) |
| POST | `/api/admin/products` | Create product |
| GET | `/api/admin/products/:id` | Get product by ID |
| PUT | `/api/admin/products/:id` | Update product |
| PATCH | `/api/admin/products/:id/status` | Toggle product status |
| GET | `/api/admin/products/:id/inventory` | Get inventory history |
| PATCH | `/api/admin/products/:productId/variants/:variantId/inventory` | Adjust stock |

**Inventory adjustment body:**
```json
{
  "quantity": 50,
  "type": "RESTOCK",
  "reason": "Restocked from supplier"
}
```

**Inventory type values:** `RESTOCK`, `ADJUSTMENT`

### Orders (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/orders` | List all orders |
| GET | `/api/admin/orders/:id` | Get order detail |
| PATCH | `/api/admin/orders/:id/status` | Update order status |
| POST | `/api/admin/orders/:id/cancel` | Cancel order |

### Shipments (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/orders/:id/shipment` | Get shipment for order |
| POST | `/api/admin/orders/:id/shipment` | Create shipment |
| PATCH | `/api/admin/orders/:id/shipment` | Update shipment |

### Refunds (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/admin/orders/:id/refund` | Initiate refund |
| GET | `/api/admin/orders/:id/refunds` | List refunds for order |

**Refund body:**
```json
{
  "amount": 89900,
  "reason": "Customer returned damaged item"
}
```

### Returns (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/returns` | List all return requests |
| GET | `/api/admin/returns/:id` | Get return detail |
| POST | `/api/admin/returns/:id/approve` | Approve return request |
| POST | `/api/admin/returns/:id/reject` | Reject return request |
| POST | `/api/admin/returns/:id/receive` | Mark item received |
| POST | `/api/admin/returns/:id/inspect` | Mark as inspecting |
| POST | `/api/admin/returns/:id/accept` | Accept return (after inspection) |
| POST | `/api/admin/returns/:id/reject-after-inspection` | Reject return (after inspection) |

**Reject body:**
```json
{
  "adminNote": "Item shows signs of use beyond inspection"
}
```

### Customers (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/customers` | List all customers |
| GET | `/api/admin/customers/:id` | Get customer detail |
| PATCH | `/api/admin/customers/:id/status` | Update customer status |

**Customer status body:**
```json
{
  "status": "SUSPENDED"
}
```

---

## Webhook Routes

### `POST /api/webhooks/razorpay`

Receive Razorpay webhook events. Mounted with `express.raw()` before `express.json()` to preserve the raw body for signature verification.

**Content-Type:** `application/json` (raw body)

Idempotent: duplicate events are safely ignored via `WebhookEvent` collection.

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `SUCCESS` | 200 | Request succeeded |
| `VALIDATION_ERROR` | 400 | Zod validation failed |
| `MONGO_VALIDATION_ERROR` | 400 | Mongoose validation failed |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
