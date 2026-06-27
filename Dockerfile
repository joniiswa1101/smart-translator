# Smart Translator Training - On-Premise Docker Image
# Usage:
#   docker build -t smart-translator .
#   docker run -e DATABASE_URL=postgresql://... -e OPENAI_API_KEY=sk-... -p 3000:3000 smart-translator

FROM node:24 AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY package.json pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/db/package.json ./lib/db/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-zod/package.json ./lib/api-zod/

# Install dependencies (allow esbuild native binary postinstall)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY artifacts/api-server/ ./artifacts/api-server/
COPY lib/ ./lib/

# Build application
RUN pnpm --filter @workspace/api-server run build

# Production stage
FROM node:24-alpine AS runner
WORKDIR /app

# Install pnpm and PostgreSQL client (for migrations)
RUN npm install -g pnpm
RUN apk add --no-cache postgresql-client

# Copy built app
COPY --from=builder /app/artifacts/api-server/dist/ ./dist/
COPY --from=builder /app/artifacts/api-server/package.json ./
COPY --from=builder /app/artifacts/api-server/public/ ./public/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/lib/ ./lib/

# Environment variables (override at runtime)
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run migrations then start server
CMD ["sh", "-c", "pnpm --filter @workspace/db run push --force && node dist/index.mjs"]
