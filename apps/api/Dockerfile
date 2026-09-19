FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --frozen-lockfile && pnpm --filter @business-os/api build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/main"]
