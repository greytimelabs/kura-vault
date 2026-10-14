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

To deploy a server, use the published images and the `deploy/` bundle:
[self-hosting](self-hosting.md). To build the images yourself:

```bash
docker build --target production -t kura-vault-server backend
docker build -t kura-vault-web web
```

Then set `KURA_SERVER_IMAGE=kura-vault-server`, `KURA_WEB_IMAGE=kura-vault-web`
and `KURA_VERSION=latest` in `deploy/.env`. The web image sends its
Content-Security-Policy from nginx, set at run time from `S3_ORIGIN`.

To host the static files elsewhere (`pnpm build`, then serve `web/dist`), the
policy is in a `<meta>` tag instead. Narrow it to your bucket at build time with
`VITE_S3_ORIGIN=https://<your-bucket-origin>`. It defaults to `https://*.amazonaws.com`.

### Multi-server build

The build above serves one server: its own. A second mode makes a client that
is hosted apart from any server, where each user types their server address
and can stay signed in to accounts on several servers:

```bash
docker build -t kura-vault-web-hosted \
  --build-arg VITE_MULTI_SERVER=true web
docker run -p 8080:8080 -e S3_ORIGIN=https: kura-vault-web-hosted
```

The published images are the single-server build; this one is built from source.

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
The app does what the web client does, with these differences:

- **Invite links are made in the web client.** The app's Users screen lists
  pending invites and can cancel them, but does not create one.
- **Photos only.** Videos are uploaded from the web client or the import CLI,
  and a video's original is downloaded there too. The app shows a video's
  poster frame and duration.
- **100 MB per photo**, up and down: a file is encrypted in one piece, in
  memory.
- **On iOS the uploaded original is a JPEG** when the photo was taken in
  another format (HEIC, the iPhone default): the system picker's plugin
  converts it before the app sees it. Android uploads the file untouched.
- **Uploads run while the app is open.** They pause in the background.
- **Fingerprint or face unlock**, which a browser cannot offer. It is off
  until switched on in Settings and replaces typing the master passphrase,
  not a vault's. See [security](security.md) for what it keeps on the phone.

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
| `app/` against the web client | see below | Docker, and an iOS simulator or Android emulator |

The crypto tests in `web/`, `migration-cli/` and `app/` all read
[`crypto-vectors.json`](../crypto-vectors.json) from the repository root. See
[crypto](crypto/README.md).

The app's interop check runs the real app against a real backend and has the
web client's own key handling read what the app wrote, and the reverse. It
also deletes a photo, an album and a vault in the app and checks from the web
side that they, and their files in storage, are gone:

```bash
cd web && pnpm exec tsx tests/interop/stack.ts          # leave running
cd web && pnpm exec tsx tests/interop/web-side.ts seed
cd app && flutter test integration_test/interop_test.dart -d <device>
cd web && pnpm exec tsx tests/interop/web-side.ts verify
```

On the Android emulator, forward the two ports first:
`adb reverse tcp:3100 tcp:3100 && adb reverse tcp:9177 tcp:9177`. Stop and
start the stack between runs; it starts from an empty database.

Fingerprint and face unlock has its own run against the same stack,
`integration_test/biometric_test.dart`. It needs a simulator or emulator with
a face or fingerprint enrolled, and a match sent from outside while it runs;
the commands are at the top of that file.

## Environment reference

Backend variables are validated at startup in `backend/src/config/validation.ts`.
For development, `backend/.env.example` has everything you need. The full list,
for a deployed server, is in [self-hosting](self-hosting.md#configuration). For
development, note:

| Variable | Development value | Why |
|---|---|---|
| `NODE_ENV` | `development` | Unset means `production`, which requires `PUBLIC_URL` |
| `POSTGRES_PORT` | `5433` | The port of the compose database in the repository root |
| `POSTGRES_SSL` | `disable` | TLS is set explicitly, never inferred from `NODE_ENV` |
| `PUBLIC_URL` | unset | When unset, the refresh cookie is not `Secure`, which Safari needs on `http://localhost` |
| `S3_ENDPOINT` | your R2 endpoint, or empty for AWS | |
