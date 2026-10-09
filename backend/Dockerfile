# ============================================
# Stage 1: Base - install dependencies only
# ============================================
FROM node:24-alpine AS base

# Security: run as non-root, add tini for signal handling
RUN apk add --no-cache tini \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && addgroup -g 1001 -S appgroup \
    && adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy only dependency files first (layer caching)
COPY --chown=appuser:appgroup package.json pnpm-lock.yaml ./

# ============================================
# Stage 2: Development
# ============================================
FROM base AS development

RUN pnpm install --frozen-lockfile

COPY --chown=appuser:appgroup . .

# Ensure entire /app is writable for dev (dist, incremental build files)
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "run", "start:dev"]

# ============================================
# Stage 3: Build - compile TypeScript
# ============================================
FROM base AS build

RUN pnpm install --frozen-lockfile

COPY --chown=appuser:appgroup . .

RUN pnpm run build

# Prune dev dependencies after build
RUN pnpm prune --prod

# ============================================
# Stage 4: Production - minimal runtime image
# ============================================
FROM node:24-alpine AS production

# Security hardening
RUN apk add --no-cache tini \
    && addgroup -g 1001 -S appgroup \
    && adduser -u 1001 -S appuser -G appgroup \
    # Remove unnecessary binaries
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -rf /opt/yarn* \
    && rm -rf /usr/local/bin/yarn* \
    && rm -rf /usr/local/bin/npx*

WORKDIR /app

# Copy only production artifacts
COPY --from=build --chown=appuser:appgroup /app/dist ./dist
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/package.json ./

# Security: non-root user, read-only filesystem compatible
USER appuser

# Security headers via env
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
