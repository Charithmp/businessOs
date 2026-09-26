# Business Operating System

Docker-first multi-tenant SaaS foundation. Phase 1 includes users, sessions, organizations, membership-based access, an organization switcher, and time-limited audited support access. Phase 2 adds a versioned product catalog, subscriptions, add-ons, entitlement resolution, usage metering, and audited commercial changes.

Phase 3 adds structured request logs, append-only audit and security events, tenant-scoped search, operational metrics, and OpenTelemetry OTLP export.

Phase 4 introduces a versioned component-tree website builder at `/websites`, sanitized HTML import, draft preview, immutable publish/rollback, AI generation routing, and custom-domain verification. Production certificate provisioning and edge routing require an external TLS edge; a verified domain remains `SSL_PENDING` until that trusted edge calls the activation endpoint. React build bundles are not executed or converted into editable components by this phase; imported HTML is converted where possible or preserved as sanitized static content.

## Local setup

1. Run `docker compose up -d`. PostgreSQL is available on host port 5433 and Redis on 6380 to avoid common local conflicts.
2. Copy `.env.example` to `.env`, replace the bootstrap password with a unique secret of at least 12 characters, and set `WEB_ORIGIN` to the URL where the web app is served (local default: `http://localhost:3000`).
3. Run `pnpm install --frozen-lockfile` and `pnpm --filter @business-os/api migrate`.
4. Run `pnpm --filter @business-os/api bootstrap` once to create the platform owner. Registration creates users but grants no organization access.
5. Run `pnpm dev`. Open `http://localhost:3000` and sign in with the bootstrap account. The API listens on port 3001.

If an existing `.env` was created before the Docker port change, update `DATABASE_URL` to host port `5433` and `REDIS_URL` to `6380`. The compose ports are not `5432` and `6379` on the host.

The platform owner can create agencies; agency owners can create businesses. An organization owner can add an existing user by email. Platform support access requires a reason and expires within one hour.

## Commercial API

Platform owners manage products, features, packages, immutable package versions, and add-ons at `/api/v1/products`, `/features`, `/packages`, and `/add-ons`. Platform owners and the owning agency's owner can assign or change a business subscription at `PUT /api/v1/subscriptions`, change add-ons and feature overrides, and record a reason. Commercial changes write subscription history and audit records in the same database transaction. A signed-in business user selects a business through `/api/v1/organizations/switch`, then reads `/api/v1/entitlements/me` and records metered use through `POST /api/v1/usage` with an idempotency key. A suspended, cancelled, expired, past-due, or elapsed trial subscription grants no enabled features. Entitlements are cached in Redis for up to 60 seconds and invalidated immediately after commercial or usage changes; PostgreSQL remains the fallback when Redis is unavailable.

## Logs and observability

Owners can search `/api/v1/observability/audit`, `/system`, and `/security` with organization, exact action/event, level, date range, and page-size filters. `/api/v1/observability/metrics` summarizes 24-hour request counts, server errors, latency and security events. The `/observability` web page provides search and summary cards. A platform owner can search globally; an organization owner sees only their organization, and an agency owner can also see descendant businesses. Support access does not grant log access.

Request logs contain only generated request/trace IDs, authenticated IDs, route templates, status and timing. They never record raw URLs, query strings, headers or bodies. Audit reasons redact secrets and common PII patterns. Audit and security rows are append-only, with no automatic deletion. High-volume system logs are pruned daily after `SYSTEM_LOG_RETENTION_DAYS` (default 30). Configure `OTEL_EXPORTER_OTLP_ENDPOINT` to send traces and metrics to an OpenTelemetry Collector over OTLP HTTP; no exporter is started when unset. Set a formal archive/retention policy for audit and security records before production.

## Quality gates

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm --filter @business-os/api test:e2e`, `pnpm --filter @business-os/api test:full-stack`, `pnpm --filter @business-os/api test:commercial-e2e`, `pnpm --filter @business-os/api test:observability-e2e`, and `pnpm --filter @business-os/api test:websites-e2e`. The end-to-end suites require the local PostgreSQL container; the commercial suite also requires Redis. They clean up their isolated test organizations but deliberately retain immutable audit/security records. The API exposes Swagger at `/api/docs` and health at `/api/v1/health`.

## Website and AI setup

Enable `website.builder`, `website.ai`, and `website.domains` through Phase 2's product/package/subscription APIs for each business. Website editors must be business or parent-agency owners/admins, or platform owners. Use `/api/v1/website-templates` and `/api/v1/websites` for templates and sites; the `/websites` page provides the visual editor. Preview stays authenticated; `/api/v1/public/sites/:slug` serves only a published version while the business has an active builder entitlement. Domain TXT verification uses `_businessos-challenge.<hostname>`; activation requires `DOMAIN_EDGE_SHARED_SECRET` and a certificate reference supplied by the trusted edge. Do not put that shared secret in the browser.

The platform owner configures model routes at `/api/v1/ai/routes` for `CHEAP`, `BALANCED`, `PREMIUM`, and `FAST`. A platform or parent-agency commercial manager sets a business budget and key source at `/api/v1/ai/settings`. A website editor can set encrypted BYO credentials at `/api/v1/ai/credentials/:provider` after setting `AI_ENCRYPTION_KEY` to 32 random bytes encoded as 64 hexadecimal characters. Platform-managed credentials come from `AI_OPENAI_API_KEY`, `AI_ANTHROPIC_API_KEY`, or `AI_GEMINI_API_KEY`. Never commit real keys. `MOCK` routes are only usable with `AI_ENABLE_MOCK=true` for tests. AI responses are validated as component trees; generated code is never executed.
