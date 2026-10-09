# Getting started

How to run every part of Kura Vault on one machine.

## Prerequisites

| Tool | Needed for | Notes |
|---|---|---|
| Node.js 24 and pnpm | backend, web, migration CLI | |
| Docker | PostgreSQL, web end-to-end tests | |
| An S3-compatible bucket | storing media | AWS S3 or Cloudflare R2 |
| Flutter (Dart SDK 3.11+) | mobile app only | |
| ffmpeg | migration CLI, for video thumbnails | |

Each component is its own package. Run `pnpm install` inside the one you are
working on; there is no workspace root.

## 1. Database

```bash
cp .env.example .env
docker compose up -d
```

This starts PostgreSQL 17, published on **localhost:5433** (not 5432). Compose
reads `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` from the root
`.env`.

## 2. Backend

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

- `POSTGRES_PASSWORD` must match the value in the root `.env`.
- `JWT_SECRET` must be at least 32 characters. Generate one with
  `openssl rand -hex 32`.
- Storage: set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
  `S3_BUCKET_NAME`.
  - **AWS S3:** set `AWS_REGION` and remove `S3_ENDPOINT`.
  - **Cloudflare R2:** set `AWS_REGION=auto` and
    `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com` (no bucket name
    in the URL).

Then:

```bash
pnpm install
pnpm migration:run
pnpm start:dev
```

The API is at `http://localhost:3000/api/v1`. Check it:

```bash
curl http://localhost:3000/api/v1/health
```

### Bucket CORS

Browsers upload and download directly to the bucket, so the bucket needs a
CORS rule for the web client's origin (`http://localhost:5173` in
development) allowing methods `GET` and `PUT` and the `content-type` header.

## 3. Web client

```bash
cd web
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to
`http://localhost:3000`, so the API and the page share an origin. Override
with `API_PROXY_TARGET` or `WEB_PORT` if you need different ports.

First use:

1. **Register.** The first device to register becomes the owner. Later
   devices need an invite code created by the owner in Settings.
2. **Create a vault** and choose its passphrase. There is no recovery: a
   forgotten passphrase means the vault's contents cannot be decrypted.
3. **Upload** a few photos.

### Production build

`web/Dockerfile` builds the static site and serves it with nginx, which also
proxies `/api/` to the backend so everything stays on one origin.

```bash
docker build -t kura-vault-web \
  --build-arg VITE_S3_ORIGIN=https://<your-bucket-origin> web
docker run -p 8080:8080 \
  -e API_UPSTREAM=http://backend:3000 \
  -e S3_ORIGIN=https://<your-bucket-origin> kura-vault-web
```

`VITE_S3_ORIGIN` and `S3_ORIGIN` narrow the Content-Security-Policy to your
bucket. They default to `https://*.amazonaws.com`.

## 4. Mobile app

```bash
cd app
flutter pub get
flutter run
```

The API address is a constant in
`lib/core/network/api_endpoints.dart` (`http://localhost:3000/api/v1`). Change
it to your machine's LAN address when running on a physical device.

## Migration CLI

Encrypts and uploads an existing folder of photos and videos into one vault.
The vault must already exist, and the device must be registered as the owner.

```bash
cd migration-cli
pnpm install
pnpm migrate \
  --source ~/Photos \
  --vault-id <vault-uuid> \
  --passphrase "<vault passphrase>" \
  --api-url http://localhost:3000/api/v1 \
  --device-id <device-id> \
  --password "<device password>" \
  --concurrency 5
```

The CLI checks the passphrase against the vault before uploading anything.
Progress is tracked in a local SQLite database, so an interrupted run can be
restarted with the same command and finished files are skipped.

Passing secrets as arguments leaves them in your shell history; clear it
afterwards or prefix the command with a space if your shell supports that.

## Tests

| Component | Command | Needs |
|---|---|---|
| `backend/` | `pnpm test` | nothing |
| `web/` unit | `pnpm test` | nothing |
| `web/` end-to-end | `pnpm test:e2e` | Docker (starts its own throwaway PostgreSQL and a fake storage server) |
| `migration-cli/` | `pnpm test` | nothing |
| `app/` | `flutter test` | Flutter |

The crypto tests in `web/`, `migration-cli/` and `app/` all read
[`crypto-vectors.json`](../crypto-vectors.json) from the repository root. See
[crypto](crypto/README.md).

## Environment reference

Backend variables, validated at startup in `backend/src/config/validation.ts`:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | yes | | Database connection |
| `POSTGRES_PORT` | no | `5432` | Use `5433` with the provided compose file |
| `JWT_SECRET` | yes | | Signing key, 32+ characters |
| `JWT_EXPIRATION` | no | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRATION` | no | `7d` | Refresh token lifetime |
| `AWS_REGION` | no | `ap-south-1` | `auto` for R2 |
| `S3_ENDPOINT` | no | | Set for S3-compatible services; leave unset for AWS |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | yes, for media | | Storage credentials |
| `S3_BUCKET_NAME` | no | `kura-vault-storage` | |
| `PORT` | no | `3000` | |
| `NODE_ENV` | no | `development` | `production` enables secure cookies and hides validation details |
| `CORS_ORIGINS` | no | `http://localhost:3000` | Comma-separated origins allowed to call the API cross-origin |
| `THROTTLE_TTL`, `THROTTLE_LIMIT` | no | `60`, `100` | Rate limit: requests per window (seconds) |
| `HASH_SALT_ROUNDS` | no | `12` | bcrypt cost for device passwords |
