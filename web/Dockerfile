FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Narrow the baked-in policy to the real bucket: --build-arg VITE_S3_ORIGIN=https://<bucket>.s3.<region>.amazonaws.com
# (for Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com)
ARG VITE_S3_ORIGIN
ENV VITE_S3_ORIGIN=$VITE_S3_ORIGIN
RUN pnpm exec vite build

FROM nginxinc/nginx-unprivileged:alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://backend:3000 S3_ORIGIN=https://*.amazonaws.com
EXPOSE 8080
