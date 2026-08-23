# THREADVIBE — Samrat Fashion

**India's Premium Destination for Oversized & Custom Graphic Tees**

A full-stack e-commerce platform for premium clothing, custom T-shirt printing, and bulk orders. Features a customer-facing storefront and a complete admin dashboard for managing catalog, orders, inventory, returns, refunds, and shipments.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| **Backend** | Express.js 5, TypeScript, Node.js |
| **Database** | MongoDB (Mongoose ODM v9.9) |
| **Auth** | JWT (access + refresh tokens), bcryptjs |
| **Payments** | Razorpay (INR) |
| **State Management** | Zustand |
| **Forms** | React Hook Form + Zod |
| **Animations** | Framer Motion |
| **Design System** | Material Design 3 inspired custom tokens |

---

## Quick Start

### Prerequisites

- Node.js v18+
- MongoDB running on `localhost:27017`
- Razorpay test account (for payments)

### 1. Clone & Install

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Environment Setup

Backend reads `backend/.env`:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/samrat_fashion
FRONTEND_URL=http://localhost:3000
JWT_ACCESS_SECRET=your_access_token_secret
JWT_REFRESH_SECRET=your_refresh_secret
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

Frontend reads `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

### 3. Seed Admin & Run

```bash
# Seed admin user
cd backend
node seed-admin.js

# Start backend (port 5000)
npm run dev

# Start frontend (port 3000) — in a new terminal
cd frontend
npm run dev
```

**Default Admin Credentials:**
- Email: `admin@samratfashion.com`
- Password: `password123`

---

## Project Structure

```
samratFashion/
├── backend/
│   └── src/
│       ├── config/          # DB connection
│       ├── middleware/       # Auth (requireAuth, requireRole), error handler
│       ├── models/          # 18 Mongoose models
│       ├── controllers/     # 14 controllers
│       ├── routes/          # 10 route files (59 total endpoints)
│       ├── services/        # RazorpayProvider, emailService, refundService
│       └── utils/           # AppError, catchAsync, Zod validation schemas
│
└── frontend/
    └── src/
        ├── app/
        │   ├── (storefront)/ # Customer-facing pages (SSR + client)
        │   ├── (auth)/       # Login, register, password reset, admin login
        │   └── (admin)/      # Admin dashboard (role-protected)
        ├── components/
        │   ├── ui/           # Navbar, Footer, Button
        │   ├── providers/    # AuthProvider, ProtectedRoute
        │   ├── catalog/      # ProductCard, ShopFilters, PDP
        │   ├── checkout/     # Checkout flow
        │   ├── account/      # Orders, addresses, returns
        │   └── admin/        # ProductForm
        ├── lib/              # Axios API client (auto token refresh), utils
        └── store/            # Zustand stores (auth, cart, orders, wishlist, addresses)
```

---

## Features

### Storefront

- **Product Catalog** — Browse by category and theme with search, sort, and filter
- **Product Detail Pages** — Size/color variant selection, image gallery, offers
- **Shopping Cart** — Add, update, remove items with live cart summary
- **Checkout** — Address selection + Razorpay payment
- **Wishlist** — Toggle products in/out of wishlist
- **User Accounts** — Register, login, forgot/reset password, address book
- **Order History** — View orders, order details, cancel orders
- **Returns** — Initiate returns with reason selection (6 reason types)

### Admin Dashboard

- **Dashboard** — Revenue KPIs, order breakdown, low stock alerts
- **Product Management** — CRUD with variant (size/color/SKU/stock) management, featured/new/bestseller flags, offers, SEO
- **Category Management** — Hierarchical categories with status, SEO, display ordering
- **Theme Management** — Graphic themes with featured flag, status, SEO
- **Order Management** — Status updates (PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED), cancellations
- **Shipment Management** — Create/update shipments with carrier, tracking (HTTPS validated), 7 shipment statuses
- **Customer Management** — View customers, suspend/disable accounts
- **Returns Workflow** — Full lifecycle: Requested → Approved → Received → Inspecting → Accepted/Rejected After Inspection → Completed; also supports customer cancellation
- **Refund Management** — Partial/full refunds via Razorpay with audit trail
- **Inventory Management** — Stock adjustments with compound unique index idempotency on SALE transactions

---

## API Overview

All API endpoints are prefixed with `/api`. See [API.md](./API.md) for full documentation.

| Group | Base Route | Auth | Endpoints |
|-------|-----------|------|-----------|
| Health | `/api/health` | Public | 1 |
| Catalog | `/api/catalog/*` | Public | 7 |
| Auth | `/api/auth/*` | Rate-limited | 7 |
| Cart | `/api/cart/*` | Customer | 5 |
| Wishlist | `/api/wishlist/*` | Customer | 4 |
| Addresses | `/api/addresses/*` | Customer | 6 |
| Orders | `/api/orders/*` | Customer | 9 |
| Payments | `/api/payments/*` | Customer | 3 |
| Admin (Catalog) | `/api/admin/*` | Admin/Super Admin | 17 |
| Admin (Ops) | `/api/admin/*` | Admin/Super Admin | 21 |
| Webhooks | `/api/webhooks/*` | Signature-verified | 1 |

**Total: 59 endpoints**

---

## Design System

Built on Material Design 3 (Material You) tokens:

- **Colors:** Primary `#004ac6`, Secondary `#aa3000`, Error `#ba1a1a`
- **Typography:** Inter (body), Hanken Grotesk (headlines), JetBrains Mono (labels)
- **Spacing:** Section gaps 120px, gutters 24px, container max 1440px
- **Dark Mode:** Token variables defined, partial `dark:` class implementation
- **Responsive:** Mobile-first with bottom nav bar; desktop with sidebar (admin)

---

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, design patterns, and data flow |
| [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) | Business domain, workflows, and feature context |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | Setup guide, coding conventions, and dev workflow |
| [API.md](./API.md) | Complete API endpoint reference (59 endpoints) |
| [DATABASE.md](./DATABASE.md) | All 18 Mongoose schemas with fields, types, and indexes |
| [SECURITY.md](./SECURITY.md) | Authentication, authorization, rate limiting, and security measures |

---

## License

Private — Samrat Fashion Internal Use Only
