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
