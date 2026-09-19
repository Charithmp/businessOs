# Business Operating System

Docker-first multi-tenant SaaS foundation. Start local infrastructure with `docker compose up -d`, copy `.env.example` to `.env`, then run `pnpm dev`.

## Quality gates

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. The API exposes Swagger at `/api/docs` and health at `/api/v1/health`.
