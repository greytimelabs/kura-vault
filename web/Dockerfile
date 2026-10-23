# Base images are pinned by digest; Dependabot keeps them current.
ARG NODE_IMAGE=node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

FROM ${NODE_IMAGE} AS build
# pnpm comes from the exact version in package.json's packageManager field
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The policy is sent by nginx, set per deployment at run time (S3_ORIGIN), not baked in
ENV VITE_CSP_META=false
# A client hosted apart from any server, where users type their server address:
# --build-arg VITE_MULTI_SERVER=true, and run with S3_ORIGIN=https: (see docs/getting-started.md)
ARG VITE_MULTI_SERVER
ENV VITE_MULTI_SERVER=$VITE_MULTI_SERVER
RUN pnpm exec vite build

FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 docker-entrypoint.d/40-kura-config.sh /docker-entrypoint.d/40-kura-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

ARG APP_VERSION=dev
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Kura Vault web" \
      org.opencontainers.image.description="Web client for Kura Vault, served with nginx; proxies the API and the bundled bucket" \
      org.opencontainers.image.source="https://github.com/greytimelabs/kura-vault" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

# S3_ORIGIN: an external bucket's origin, for the policy. Empty when the bucket is
# served from this origin (S3_PROXY_UPSTREAM). Only API_UPSTREAM and the resolver are
# substituted in the template; the other values are checked and rendered by 40-kura-config.sh
ENV API_UPSTREAM=http://server:3000 \
    S3_ORIGIN= \
    S3_PROXY_UPSTREAM= \
    S3_BUCKET_NAME= \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_FILTER=^(API_UPSTREAM|NGINX_LOCAL_RESOLVERS)$

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
