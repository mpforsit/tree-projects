# Lean — Next.js app image (Coolify Dockerfile deploy, spec §12)
FROM node:22-alpine AS base
RUN corepack enable pnpm

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations, scripts, and their lib imports ship with the image so the
# deploy pipeline can run `node --experimental-strip-types
# scripts/migrate.ts` (owner role) before app start, and the scheduled
# task can run scripts/worker-alarms.ts (imports lib/log.ts).
COPY --from=build /app/db ./db
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/lib ./lib
USER app
EXPOSE 3000
CMD ["node", "server.js"]
