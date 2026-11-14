# CI/CD Pipeline

The pipeline lives in `.github/workflows/` and has two workflows:

| Workflow | File | Trigger | Purpose |
| --- | --- | --- | --- |
| **CI** | `.github/workflows/ci.yml` | Pull requests to `main`, pushes to `main`, manual dispatch | Lint, test, and build both apps. Required for merges. |
| **Deploy** | `.github/workflows/deploy.yml` | Successful CI run on `main`, manual dispatch from `main` | Triggers the Render (backend) and Netlify (frontend) production deploys. |

## What CI runs

### Frontend (`frontend/`)

1. `npm ci`
2. `npm run lint`
3. `npm test` (Node test runner over `src/tests/*.test.ts`)
4. `npm run build` (Next.js production build; this also type-checks)

The build uses placeholder `NEXT_PUBLIC_*` origins because the artefact is not
deployed — Netlify builds the real deploy bundle with its own environment
variables.

### Backend (`backend/`)

`npm ci`, `npm run build`, then `npm test` against a real single-node MongoDB
replica set started in the job. A replica set is used (instead of a standalone
`mongod`) because production requires one and the tests exercise multi-document
transactions.

Before the suites run, `backend/scripts/prepare-test-db.js` builds every Mongoose
index in the isolated test database. Some suites write immediately after
connecting, and a background index build on a brand-new database can make those
writes fail with transient `LockTimeout` / "catalog changes" errors. Pre-building
the indexes keeps CI deterministic.

Dummy credentials are supplied as job-level environment variables
(`JWT_*`, `ALLOW_*_MOCK`, `CLOUDINARY_CLOUD_NAME=demo`). Real secrets are never
used in CI.

### Backend critical security suites

A matrix job runs each of these in its own fresh replica set and database, so a
failure in one cannot poison another:

- `test:webhook-lease`
- `test:integrity`
- `test:remediation`
- `test:b1-b4`

`test:a22` is intentionally not gated yet: check `B.19` (idempotency key
attempt number) currently fails. Add it to the matrix once that is fixed.

## Required repository secrets

Configure these under **Settings → Secrets and variables → Actions**:

| Secret | Where to get it |
| --- | --- |
| `RENDER_DEPLOY_HOOK_URL` | Render → your backend service → **Settings → Deploy Hook** |
| `NETLIFY_BUILD_HOOK_URL` | Netlify → Site configuration → **Build & deploy → Build hooks** |

If a secret is missing, the deploy workflow logs a warning and skips that target
instead of failing. Add both before relying on automated deploys.

> **Netlify note:** if the site is also connected to this GitHub repository for
> automatic deploys, every push to `main` will deploy twice (once from Netlify's
> Git integration, once from the build hook). Keep only one of them — the build
> hook is recommended so deploys only start after CI is green.

## Recommended branch protection

On `main`, require these checks to pass before merging:

- `Frontend / lint, tests, build`
- `Backend / build + main test suite`
- `Backend / webhook-lease`
- `Backend / integrity`
- `Backend / remediation`
- `Backend / b1-b4`

Also enable _Require branches to be up to date before merging_ so the pipeline
runs against the commit that will actually be deployed.

## Running the same checks locally

From the repository root:

```bash
npm ci --prefix frontend
npm run lint --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend

npm ci --prefix backend
npm run build --prefix backend
```

The backend suites need an isolated MongoDB database and a replica set. With a
local `mongod` started as `--replSet rsTest`, run:

```bash
export TEST_MONGODB_URI='mongodb://127.0.0.1:27017/samrat_fashion_test_isolated?replicaSet=rsTest&directConnection=true'
export JWT_ACCESS_SECRET=local-test-access-secret
export JWT_REFRESH_SECRET=local-test-refresh-secret
export CLOUDINARY_CLOUD_NAME=demo
export ALLOW_PAYMENT_MOCK=true ALLOW_AUTH_MOCK=true
export ALLOW_LOGISTICS_MOCK=true ALLOW_EMAIL_MOCK=true
export EMAIL_PROVIDER=console

cd backend
node scripts/prepare-test-db.js
npm test
npm run test:webhook-lease
npm run test:integrity
npm run test:remediation
npm run test:b1-b4
```

On PowerShell, use `$env:NAME="value"` instead of `export`.
