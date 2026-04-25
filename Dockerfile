FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/judge/package.json ./apps/judge/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- Build shared ---
FROM base AS build-shared
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared/ ./packages/shared/
RUN cd packages/shared && pnpm build

# --- Build server ---
FROM base AS build-server
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build-shared /app/packages/shared/dist ./packages/shared/dist
COPY apps/server/ ./apps/server/
COPY packages/shared/ ./packages/shared/
RUN cd apps/server && pnpm prisma:generate && pnpm build

# --- Build web ---
FROM base AS build-web
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY apps/web/ ./apps/web/
COPY packages/shared/ ./packages/shared/
RUN cd apps/web && pnpm build

# --- Build judge ---
FROM base AS build-judge
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/judge/node_modules ./apps/judge/node_modules
COPY apps/judge/ ./apps/judge/
RUN cd apps/judge && pnpm build

# --- Production server ---
FROM node:20-alpine AS production
RUN corepack enable
# 安装 PM2 用于进程管理
RUN npm install -g pm2
WORKDIR /app

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/judge/package.json ./apps/judge/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=build-server /app/apps/server/dist ./apps/server/dist
COPY --from=build-server /app/apps/server/prisma ./apps/server/prisma
COPY --from=build-web /app/apps/web/.next ./apps/web/.next
COPY --from=build-web /app/apps/web/public ./apps/web/public
COPY --from=build-web /app/apps/web/package.json ./apps/web/package.json
COPY --from=build-judge /app/apps/judge/dist ./apps/judge/dist

# Copy shared package
COPY --from=build-shared /app/packages/shared/dist ./packages/shared/dist
COPY packages/shared/package.json ./packages/shared/

# Copy testdata directory
COPY apps/server/testdata ./apps/server/testdata

# Copy PM2 ecosystem config
COPY ecosystem.config.js ./

EXPOSE 3000 3002

# 使用 PM2 启动前端、后端和评测机
CMD ["pm2-runtime", "start", "ecosystem.config.js"]
