# Business Operating System

Docker-first multi-tenant SaaS foundation. Phase 1 includes users, sessions, organizations, membership-based access, an organization switcher, and time-limited audited support access. Phase 2 adds a versioned product catalog, subscriptions, add-ons, entitlement resolution, usage metering, and audited commercial changes.

## Local setup

1. Run `docker compose up -d`. PostgreSQL is available on host port 5433 and Redis on 6380 to avoid common local conflicts.
2. Copy `.env.example` to `.env` and replace the bootstrap password with a unique secret of at least 12 characters.
3. Run `pnpm install --frozen-lockfile` and `pnpm --filter @business-os/api migrate`.
4. Run `pnpm --filter @business-os/api bootstrap` once to create the platform owner. Registration creates users but grants no organization access.
5. Run `pnpm dev`. Open `http://localhost:3000` and sign in with the bootstrap account. The API listens on port 3001.

If an existing `.env` was created before the Docker port change, update `DATABASE_URL` to host port `5433` and `REDIS_URL` to `6380`. The compose ports are not `5432` and `6379` on the host.

The platform owner can create agencies; agency owners can create businesses. An organization owner can add an existing user by email. Platform support access requires a reason and expires within one hour.

## Commercial API

Platform owners manage products, features, packages, immutable package versions, and add-ons at `/api/v1/products`, `/features`, `/packages`, and `/add-ons`. Platform owners and the owning agency's owner can assign or change a business subscription at `PUT /api/v1/subscriptions`, change add-ons and feature overrides, and record a reason. Commercial changes write subscription history and audit records in the same database transaction. A signed-in business user selects a business through `/api/v1/organizations/switch`, then reads `/api/v1/entitlements/me` and records metered use through `POST /api/v1/usage` with an idempotency key. A suspended, cancelled, expired, past-due, or elapsed trial subscription grants no enabled features. Entitlements are cached in Redis for up to 60 seconds and invalidated immediately after commercial or usage changes; PostgreSQL remains the fallback when Redis is unavailable.

## Quality gates

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm --filter @business-os/api test:e2e`, `pnpm --filter @business-os/api test:full-stack`, and `pnpm --filter @business-os/api test:commercial-e2e`. The end-to-end suites require the local PostgreSQL container; the commercial suite also requires Redis. They clean up their isolated test organizations. The API exposes Swagger at `/api/docs` and health at `/api/v1/health`.
