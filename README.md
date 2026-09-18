# Business Operating System

Cloud-neutral, Docker-first multi-tenant SaaS foundation for a Platform -> Agency -> Business hierarchy.

## Delivered foundation

This repository starts the implementation plan with Phases 0 through 3:

1. **Foundation** - pnpm workspace, Docker Compose, Next.js web app, NestJS API, PostgreSQL, Redis, Prisma, OpenAPI, linting and CI.
2. **Identity and tenancy** - organization hierarchy, memberships, roles/permissions, scoped requests and audited support access data model.
3. **Catalog and subscriptions** - versioned packages, features, subscriptions, limits, history and entitlement resolution contracts.
4. **Audit and observability** - append-only audit records, structured application logging, trace correlation and redaction helpers.

Phase 4 is now underway with versioned, safe component trees; immutable publish/deployment records; a local site-planning adapter behind an AI Gateway contract; and tenant-scoped domain verification instructions. External AI, DNS, SSL and deployment adapters remain deliberately replaceable.

The remaining document phases are represented as bounded module folders and implementation backlog in [docs/implementation-roadmap.md](docs/implementation-roadmap.md).

## Run locally

1. Copy `.env.example` to `.env` and replace development secrets.
2. Start dependencies and wait until PostgreSQL and Redis are healthy:

   ```powershell
   docker compose up -d --wait postgres redis
   ```
3. Install packages with the repository's pinned pnpm version:

   ```powershell
   corepack pnpm install
   ```

   This project requires Node.js 18.12 or later. `corepack pnpm` works without a global pnpm installation. If Corepack is unavailable, install pnpm globally instead: `npm install --global pnpm@9.15.4` and replace `corepack pnpm` with `pnpm` in the commands below.
5. Generate and migrate the database:

   ```powershell
   corepack pnpm db:generate
   corepack pnpm db:migrate
   ```

   On the first migration, Prisma may prompt for a migration name. Use `init`. If this step fails, confirm the database is healthy with `docker compose ps`, then run `corepack pnpm --filter @bos/db migrate` to show Prisma's underlying error (rather than only pnpm's workspace error).
6. Start the apps: `corepack pnpm dev`.

The API runs at `http://localhost:3001/api/v1`; Swagger is available at `/api/docs`. The web app runs at `http://localhost:3000`.

### Local database troubleshooting

- Ensure Docker Desktop is running and that your user can access the Docker daemon.
- If `docker compose ps` does not show `postgres` as `healthy`, inspect it with `docker compose logs postgres` and retry the migration after it is healthy.
- A Prisma `P1001` error means PostgreSQL is not reachable. Confirm `DATABASE_URL` in `.env` uses the local Docker defaults from `.env.example` unless you intentionally use another database.

## Security invariants

- Organization scope always comes from authenticated membership, never a browser-supplied organization id alone.
- Business-owned records must include `organizationId` and be queried through the organization scope.
- Permission checks and entitlement checks are separate and both are required for protected product actions.
- Support access must be time limited, reasoned and audited.
- Secrets, tokens and personally identifying fields must be redacted before logs are emitted.
