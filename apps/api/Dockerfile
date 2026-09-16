FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/api apps/api
COPY packages/db packages/db
WORKDIR /app/apps/api
RUN pnpm build
EXPOSE 3001
CMD ["node", "dist/main.js"]
