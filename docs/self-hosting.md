# Self-hosting

Run your own Kura Vault server, with the web client, from the published images.
The mobile apps need nothing extra: users type your server's address into the app.

For running from source (development), see [getting started](getting-started.md).

- [What you need](#what-you-need)
- [Install](#install)
- [Put it behind HTTPS](#put-it-behind-https)
- [Create the owner account](#create-the-owner-account)
- [Storage](#storage)
- [Configuration](#configuration)
- [Backups](#backups)
- [Upgrades](#upgrades)
- [Verify the images](#verify-the-images)
- [How the deployment is hardened](#how-the-deployment-is-hardened)
- [Troubleshooting](#troubleshooting)

## What you need

- A Linux server (amd64 or arm64) with at least 1 CPU core, 1 GB of memory, and
  disk space for your media.
- Docker Engine with Compose v2 (`docker compose version`).
- A domain name, such as `vault.example.com`, pointing at the server.
- **HTTPS.** This is not optional. The web client encrypts in the browser with
  WebCrypto, which browsers only offer on secure pages. Over plain `http://`
  (other than `localhost`), the web client cannot work. You provide TLS with your own reverse
  proxy: Caddy, nginx, Traefik, Cloudflare Tunnel or any other.

## Install

The stack has four containers:

| Container | Image | What it does |
|---|---|---|
| `web` | `kura-vault-web` | The only one with a published port. Serves the web client, proxies `/api/` to the server, and proxies the bucket |
| `server` | `kura-vault-server` | The API. Runs database migrations at start |
| `postgres` | `postgres:18-alpine` | The database |
| `garage` | `dxflrs/garage` | Bundled S3-compatible storage for media (optional; see [Storage](#storage)) |

### With the installer

```bash
curl -fsSLO https://github.com/greytimelabs/kura-vault/releases/latest/download/install.sh
less install.sh        # read it first
sh install.sh
```

It creates `./kura-vault` with the release's `docker-compose.yml`, `garage.toml`
and a `.env`, checks every file against the release's `SHA256SUMS`, generates
all secrets with `openssl rand`, and asks before starting anything. It needs
no root. For a specific release, run `KURA_VERSION=1.2.0 sh install.sh`.

### By hand

```bash
mkdir kura-vault && cd kura-vault
base=https://github.com/greytimelabs/kura-vault/releases/latest/download
for f in docker-compose.yml example.env garage.toml SHA256SUMS; do curl -fsSLO "$base/$f"; done
sha256sum --ignore-missing -c SHA256SUMS
cp example.env .env
chmod 600 .env
```

Edit `.env`. Set `PUBLIC_URL`, and replace every `CHANGE_ME` using the command
written above it. `KURA_VERSION` is already set to the release you downloaded.
Then:

```bash
docker compose up -d --wait
```

The web container now listens on `127.0.0.1:8080`. Next, put HTTPS in front of it.

## Put it behind HTTPS

Your reverse proxy terminates TLS for `PUBLIC_URL` and forwards to
`127.0.0.1:8080` (`HTTP_BIND`:`HTTP_PORT` in `.env`). Two things matter:

1. **Pass the original `Host` header through, unchanged.** Upload and download
   links are signed for `PUBLIC_URL`'s host. A proxy that rewrites `Host`
   breaks every signature, and uploads fail with *Invalid signature*.
2. **Do not limit or buffer request bodies** on the whole site. Encrypted
   originals go through it, and videos can be large.

**Caddy** (automatic Let's Encrypt; passes `Host` through by default):

```caddy
vault.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

**nginx**:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name vault.example.com;
    ssl_certificate     /etc/letsencrypt/live/vault.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vault.example.com/privkey.pem;

    client_max_body_size 0;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;          # required: links are signed for this host
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Traefik** (the web container joins Traefik's network instead of publishing a port):

```yaml
# docker-compose.override.yml, next to docker-compose.yml
services:
  web:
    ports: !reset []
    networks: [storage, edge, traefik]
    labels:
      traefik.enable: "true"
      traefik.http.routers.kura.rule: Host(`vault.example.com`)
      traefik.http.routers.kura.entrypoints: websecure
      traefik.http.routers.kura.tls.certresolver: letsencrypt
      traefik.http.services.kura.loadbalancer.server.port: "8080"
networks:
  traefik:
    external: true
```

**Cloudflare Tunnel**: point the public hostname at `http://localhost:8080`, and
leave *HTTP Host Header* empty so the original host is kept. On Cloudflare's
free plan a single request is limited to 100 MB, so larger videos cannot be
uploaded through it.

If your proxy uses a port other than 443, include it in `PUBLIC_URL`
(`https://vault.example.com:8443`).

**Client addresses.** Rate limiting and login lockout work per client address,
which the web container reads from `X-Forwarded-For`. By default it accepts
that header only from loopback and private addresses, where a proxy on the
same host or network sits. If your proxy reaches the web container from a
public address, set `TRUSTED_PROXIES` to that address. Keep
`HTTP_BIND=127.0.0.1` unless the proxy runs on another machine. Otherwise
anyone on your network can bypass it.

## Create the owner account

Open `PUBLIC_URL`. A new server opens on the setup screen. Enter the **setup
key**: the installer printed it and wrote it to `SETUP_KEY` in `.env`. If you
left `SETUP_KEY` empty, a key is generated and printed instead:

```bash
docker compose logs server | grep -A3 "setup key"
```

Choose the owner's username, password and master passphrase. The key stops
working the moment the owner exists. Then add users from **Settings → Manage
users** with invite links. There is no public sign-up.

The **master passphrase** and every **vault passphrase** never reach the
server and cannot be recovered by anyone, including you as the operator.
Make sure your users know.

## Storage

Encrypted media is stored in S3-compatible object storage. Browsers and apps
upload and download directly with short-lived signed links, so the media never
passes through the API.

### Bundled Garage (default)

The `garage` profile runs [Garage](https://garagehq.deuxfleurs.fr) as a single
node. On first start it creates one bucket and one access key from `.env`. The
web container serves the bucket on your own address (`PUBLIC_URL/kura-blobs/…`),
which gives you:

- **no bucket CORS** to configure;
- **no second hostname or certificate**;
- **a tighter Content-Security-Policy**: the page may only connect to its own origin.

Media lives in the `garage-data` volume. To keep it on another disk, set
`KURA_MEDIA_DIR=/path/on/that/disk` before the first start.

A single Garage node has no redundancy. A failed disk loses the media unless
you have [backups](#backups).

### Your own bucket (AWS S3, Cloudflare R2, Backblaze B2, …)

In `.env`, comment out *Option A* and fill in *Option B*:

```bash
COMPOSE_PROFILES=
AWS_REGION=auto                                          # your bucket's region; auto for R2
S3_BUCKET_NAME=kura-vault-storage
AWS_ACCESS_KEY_ID=...                                    # a key for this bucket only
AWS_SECRET_ACCESS_KEY=...
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com  # empty for AWS S3
S3_PUBLIC_ENDPOINT=
S3_PROXY_UPSTREAM=
S3_ORIGIN=https://<account-id>.r2.cloudflarestorage.com    # https://<bucket>.s3.<region>.amazonaws.com for AWS
```

`S3_ORIGIN` is the origin browsers download from. It is added to the page's
`connect-src` policy.

Browsers talk to the bucket directly, so it needs a CORS rule for your address:

```json
[
  {
    "AllowedOrigins": ["https://vault.example.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Give the access key rights to that one bucket only: get, put and delete object.
Leave bucket versioning off. Versions would keep copies of files users delete.

## Configuration

Everything is set in `.env`. The compose file passes on only what each
container needs.

| Variable | Default | Purpose |
|---|---|---|
| `KURA_VERSION` | (required) | Release to run, e.g. `1.2.0`. Change it to upgrade |
| `KURA_SERVER_IMAGE`, `KURA_WEB_IMAGE` | GHCR | Image names, e.g. `docker.io/greytimelabs/kura-vault-server` for the Docker Hub mirror |
| `PUBLIC_URL` | (required) | The `https://` origin users open. Signed links, CORS and the cookie's `Secure` flag follow it |
| `HTTP_BIND`, `HTTP_PORT` | `127.0.0.1`, `8080` | Where the web container listens, for your proxy |
| `TRUSTED_PROXIES` | private ranges | Space-separated addresses or CIDRs allowed to set `X-Forwarded-For` |
| `POSTGRES_PASSWORD` | (required) | Database password |
| `POSTGRES_USER`, `POSTGRES_DB` | `kuravault` | |
| `POSTGRES_SSL` | `disable` | `require` or `verify-full` for a database elsewhere |
| `JWT_SECRET` | (required) | Signs access tokens. 32+ random characters |
| `SETUP_KEY` | generated | Creates the owner account. Useless once it exists |
| `COMPOSE_PROFILES` | `garage` | Empty to run without the bundled Garage |
| `AWS_REGION` | (required) | `garage` for the bundled Garage, or your bucket's region |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | (required) | Storage credentials. Also create Garage's key |
| `GARAGE_RPC_SECRET` | (required with Garage) | 32 random bytes as hex |
| `S3_BUCKET_NAME` | `kura-blobs` | |
| `S3_ENDPOINT` | | Where the server reaches storage. Empty for AWS S3 |
| `S3_PUBLIC_ENDPOINT` | | Where browsers reach storage, if different. `${PUBLIC_URL}` with Garage |
| `S3_PROXY_UPSTREAM` | | Storage the web container serves at `/<bucket>/`. `http://garage:3900` with Garage |
| `S3_ORIGIN` | | External bucket origin, for the Content-Security-Policy |
| `KURA_MEDIA_DIR` | `garage-data` volume | Host path for Garage's media |
| `THROTTLE_LIMIT` | `100` | API requests per minute per client |
| `CORS_ORIGINS` | `PUBLIC_URL` | Extra origins allowed to call the API, such as a hosted web client |

**Secrets as files.** The server also reads `JWT_SECRET_FILE`,
`POSTGRES_PASSWORD_FILE`, `AWS_ACCESS_KEY_ID_FILE`, `AWS_SECRET_ACCESS_KEY_FILE`
and `SETUP_KEY_FILE`. Each holds a path whose contents become that variable. Use
them with Docker or Kubernetes secrets in a compose override. Setting both forms
of one variable is an error.

The server checks its configuration at start and refuses to run with a clear
message if something is wrong. A plain `http://` `PUBLIC_URL` is one example.
See `docker compose logs server`.

## Backups

Back up three things. All three are needed to restore:

1. **The database:**

   ```bash
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > kura-db-$(date +%F).dump
   ```

2. **The media.** With Garage, stop it briefly and copy both volumes:

   ```bash
   docker compose stop garage
   docker run --rm -v kura-vault_garage-meta:/meta:ro -v kura-vault_garage-data:/data:ro \
     -v "$PWD":/backup alpine tar czf /backup/kura-media-$(date +%F).tar.gz /meta /data
   docker compose start garage
   ```

   (Or the directory you set as `KURA_MEDIA_DIR`, plus the `garage-meta` volume.)
   With your own bucket, use your provider's replication or `rclone sync`.

3. **`.env`.** Without it the database password, the storage key and the
   sessions are gone. Keep it somewhere private: it holds secrets.

Everything in the backup is encrypted or wrapped by keys only your users hold.
A backup is safe to keep off-site. It is also useless to anyone who has
forgotten their passphrase: restoring cannot bring back access.

**Restore** on a fresh install of the same release:

1. `docker compose up -d postgres`.
2. Restore the database:

   ```bash
   docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < kura-db.dump
   ```

3. Unpack the media archive into the two volumes.
4. `docker compose up -d`.

## Upgrades

Read the release notes first: they call out anything you need to do. Then:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > before-upgrade.dump
sed -i 's/^KURA_VERSION=.*/KURA_VERSION=1.3.0/' .env     # the new release
curl -fsSLO https://github.com/greytimelabs/kura-vault/releases/download/v1.3.0/docker-compose.yml
docker compose pull
docker compose up -d --wait
```

Database migrations run when the new server starts. Going back to an older
release after a migration is not supported. Restore the dump instead.

**Tags.** Images are tagged `1.3.0`, `1.3`, `1`, `latest` and `edge` (the main
branch, unreleased). Pin an exact version in `KURA_VERSION`, so nothing
changes until you decide.

**PostgreSQL major versions** (such as 18 to 19) cannot read each other's data
directory. The compose file only moves to a new major in a release that says so.
To move:

1. Dump the database (above).
2. `docker compose down`, then remove the `kura-vault_db-data` volume.
3. Update the files.
4. `docker compose up -d postgres`, then restore.

## Verify the images

Every image is built by this repository's release workflow and signed with
[cosign](https://github.com/sigstore/cosign) through GitHub's OIDC identity.
No key exists that could be stolen. To check an image before you run it:

```bash
cosign verify ghcr.io/greytimelabs/kura-vault-server:1.2.0 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/greytimelabs/kura-vault/\.github/workflows/release\.yml@refs/tags/v'
```

Do the same for `kura-vault-web`, or for the `docker.io/greytimelabs/...` mirror.
Each image also carries a build provenance attestation and an SBOM:

```bash
docker buildx imagetools inspect ghcr.io/greytimelabs/kura-vault-server:1.2.0 --format '{{ json .Provenance }}'
docker buildx imagetools inspect ghcr.io/greytimelabs/kura-vault-server:1.2.0 --format '{{ json .SBOM }}'
```

To make sure you run exactly what you verified, use the digest:
`KURA_SERVER_IMAGE=ghcr.io/greytimelabs/kura-vault-server@sha256:…`. Do the
same for the web image, and leave `KURA_VERSION` set, since it is still
required. Or pin the digest in a compose override.

## How the deployment is hardened

- **One published port**, on `127.0.0.1` by default. The database and Garage
  are on internal Docker networks with no route to the host or the internet.
  The server can reach out only for external storage.
- **Every container runs** with a read-only root filesystem, all Linux
  capabilities dropped, `no-new-privileges`, and a process limit. The server
  (UID 1001), web (UID 101) and PostgreSQL (UID 70) run as non-root. Garage
  runs as root in its scratch image, without any capabilities.
- **Strict Content-Security-Policy** set by the web container: scripts only from
  this origin, and connections only to this origin (plus `S3_ORIGIN`). It also
  sends `Referrer-Policy: no-referrer`, `nosniff`, `frame-ancestors 'none'`
  and HSTS. HSTS has no `includeSubDomains` and no preload, because those
  would reach beyond this server.
- **Signed links are short-lived:** 60 seconds to download, 15 minutes to upload.
  They only ever yield ciphertext.
- **Inputs are checked at start:** the server validates its whole
  configuration, and the web container validates every value it puts into its
  nginx configuration or headers.
- **Logs are rotated** (3 × 10 MB per container).
- **Images are minimal, scanned and signed:** the server image has no npm,
  corepack or yarn. Each build is scanned for known vulnerabilities in CI,
  and every published image is signed.

The security model of the application itself is in [security.md](security.md).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The page loads but nothing works, or `crypto.subtle` is undefined | Opened over `http://`. Use the `https://` address |
| Uploads fail with *Invalid signature* (403) | The proxy changes the `Host` header. Pass it through (`proxy_set_header Host $host;`), and include any non-443 port in `PUBLIC_URL` |
| Uploads of large files fail (413) | The proxy limits body size (`client_max_body_size 0;` in nginx). With Cloudflare, requests over 100 MB are refused |
| Downloads blocked: *violates the Content Security Policy* | External bucket: `S3_ORIGIN` does not match the bucket's origin |
| Uploads fail with a CORS error | External bucket: its CORS rule does not allow `PUBLIC_URL`, `PUT` and `content-type` |
| `server` exits at start | Run `docker compose logs server`. It names the setting that is wrong |
| `web` keeps restarting | Run `docker compose logs web`. A value in `S3_ORIGIN`, `S3_PROXY_UPSTREAM`, `S3_BUCKET_NAME` or `TRUSTED_PROXIES` was rejected |
| Everyone gets *Too many requests* | The proxy is not trusted, so all users share its address. Set `TRUSTED_PROXIES` to the proxy's address |
| Setup screen says the key is wrong | With `SETUP_KEY` empty, a new key is printed at every restart. Use the latest one, or set `SETUP_KEY` |
| The app or a hosted web client cannot connect | It needs the `https://` root (`https://vault.example.com`), not `/api/v1`. A hosted web client's origin goes in `CORS_ORIGINS` |
