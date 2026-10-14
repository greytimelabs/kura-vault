# Base images are pinned by digest; Dependabot keeps them current.
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

# ============================================
# Stage 1: Base - install dependencies only
# ============================================
FROM ${NODE_IMAGE} AS base

# Security: run as non-root, add tini for signal handling.
# pnpm comes from the exact version in package.json's packageManager field.
RUN apk add --no-cache tini \
    && corepack enable \
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

RUN pnpm run build \
    && rm -f dist/.tsbuildinfo

# Prune dev dependencies after build
RUN pnpm prune --prod

# ============================================
# Stage 4: Production - minimal runtime image
# ============================================
FROM ${NODE_IMAGE} AS production

# Security hardening
RUN apk add --no-cache tini \
    && addgroup -g 1001 -S appgroup \
    && adduser -u 1001 -S appuser -G appgroup \
    # Remove package managers: nothing is installed at run time
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -rf /opt/yarn* /usr/local/bin/yarn* /usr/local/bin/npx* /usr/local/bin/npm /usr/local/bin/corepack

WORKDIR /app

# Copy only production artifacts. Root-owned and read-only to the app user:
# the container runs with a read-only root filesystem and writes nothing to /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

ARG APP_VERSION=dev
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Kura Vault server" \
      org.opencontainers.image.description="API for Kura Vault, self-hosted end-to-end encrypted photo and video storage" \
      org.opencontainers.image.source="https://github.com/greytimelabs/kura-vault" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

USER appuser

# A deployed server: migrations run at start, and one proxy (the web container) is
# trusted for the client address. Override either in the environment
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION} \
    MIGRATIONS_RUN=true \
    TRUST_PROXY=1

EXPOSE 3000

# Node's own fetch, so the check needs no extra tools in the image
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
