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

1. **Create the owner account.** A server with no owner prints a setup key
   when it starts:

   ```
   No owner account yet. Open a Kura Vault client, choose this
   server and enter this setup key to create the owner account:

      <setup key>
   ```

   The page opens on the setup screen. Enter the key, pick a username, a
   password and a master passphrase. The key works once; a new one is printed
   on every start until an owner exists. To choose it yourself, set
   `SETUP_KEY` (32 characters or more) in `backend/.env`.
2. **Create a vault** and choose its passphrase.
3. **Upload** a few photos.
4. **Add someone**: Settings → Manage users → Add user gives an invite link.
   They open it and choose their own password and master passphrase. Then
   share a vault (Settings → Share) or one album (Share on the album) with
   them.

There are three secrets and no recovery for two of them. The **password**
signs in. The **master passphrase** unlocks your keys and is never sent to
the server; if it is forgotten, everything only that account could open is
lost. Each vault you create has its own **vault passphrase** on top.

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

### Multi-server build

The build above serves one server: its own. A second mode makes a client that
is hosted apart from any server, where each user types their server address
and can stay signed in to accounts on several servers:

```bash
docker build -t kura-vault-web-hosted \
  --build-arg VITE_MULTI_SERVER=true web
docker run -p 8080:8080 -e S3_ORIGIN=https: kura-vault-web-hosted
```

In this mode the policy's `connect-src` allows any `https:` origin, because
the servers and buckets are not known in advance, and refresh tokens are kept
in browser storage instead of an httpOnly cookie. Read
[security.md](security.md#hosted-clients) before choosing it; for your own
server the default build is the stronger setup.

## 4. Mobile app

```bash
cd app
flutter pub get
flutter run
```

The app asks for the server address on first launch, then for a username and
password. For a backend on your machine use `http://10.0.2.2:3000` from the
Android emulator, `http://localhost:3000` from the iOS simulator, or your
machine's LAN address from a physical device. A server with no owner yet goes
to the setup screen; "I have an invite link" joins with a link from the owner.
The app is a viewer: uploading, creating vaults, managing users and sharing
are done in the web client.

More accounts, on the same or other servers, are added from the account
button in the top bar. Switching account locks everything and asks for the
other account's master passphrase. Only the server address and username are
remembered on the device, never the password.

`http://` is accepted only for localhost and private network addresses, after
a warning. Any other server must use `https://`.

## Using the published apps with your server

The store apps and a hosted web client are the same code as in this
repository, pointed at whatever server the user types. To make your server
usable from them:

1. **Serve the API over HTTPS** on an address your devices can reach, for
   example behind a reverse proxy with a certificate. Clients append
   `/api/v1` themselves; give users the server root, such as
   `https://vault.example.com`.
2. **Mobile apps need nothing else.** They do not use CORS.
3. **For a hosted web client**, add its origin to `CORS_ORIGINS` on the
   backend, and to your bucket's CORS rule (methods `GET` and `PUT`, header
   `content-type`), since the browser talks to both directly.

A client checks an address by calling `GET /api/v1/health` and expecting
`"app": "kura-vault"` in the answer.

## Migration CLI

Encrypts and uploads an existing folder of photos and videos into one vault.
The vault must already exist, and the account must have created it or have it
shared with write access.

```bash
cd migration-cli
pnpm install
pnpm migrate \
  --source ~/Photos \
  --vault-id <vault-uuid> \
  --api-url http://localhost:3000/api/v1 \
  --username <username> \
  --concurrency 5
```

It asks for the password, the master passphrase and, for a vault you created,
the vault passphrase, without echoing them. For unattended runs set
`KURA_PASSWORD`, `KURA_MASTER_PASSPHRASE` and `KURA_VAULT_PASSPHRASE`, or pass
`--password`, `--master-passphrase` and `--passphrase`. Add
`--album-id <album-uuid>` to also put every file into one album.

The CLI opens the vault before uploading anything, so a wrong passphrase stops
it at the start. Progress is tracked in a local SQLite database, so an
interrupted run can be restarted with the same command and finished files are
skipped.

Passing secrets as arguments leaves them in your shell history; clear it
afterwards or prefix the command with a space if your shell supports that.

## Tests

| Component | Command | Needs |
|---|---|---|
| `backend/` | `pnpm test` | nothing |
| `web/` unit | `pnpm test` | nothing |
| `web/` server rules | `pnpm test:api` | Docker (its own throwaway PostgreSQL). No browser: the real key handling against the real API, including tampered rows, forged shares and revoked access |
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
| `HASH_SALT_ROUNDS` | no | `12` | bcrypt cost for account passwords |
