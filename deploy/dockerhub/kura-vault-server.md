# Kura Vault server

The API for [Kura Vault](https://github.com/greytimelabs/kura-vault): self-hosted,
end-to-end encrypted storage for personal photos and videos.

Media is encrypted on the device before it is uploaded. This server stores
encrypted keys and metadata in PostgreSQL and hands out short-lived pre-signed
URLs for S3-compatible object storage. It never sees a passphrase, a key, or a
decrypted file, and media bytes never pass through it.

> **Status:** early and under active development. It has not had an independent
> security review. Do not make it the only copy of anything you care about.

## Quick start

Don't run this image on its own. It's one part of a stack: this server, the
[web client](https://hub.docker.com/r/greytimelabs/kura-vault-web), PostgreSQL
and object storage. The installer sets up all of it with Docker Compose, including
bundled Garage storage, and generates the secrets:

```bash
curl -fsSLO https://github.com/greytimelabs/kura-vault/releases/latest/download/install.sh
less install.sh && sh install.sh
```

To pull from Docker Hub instead of GHCR, set this in the generated `.env`:

```bash
KURA_SERVER_IMAGE=docker.io/greytimelabs/kura-vault-server
KURA_WEB_IMAGE=docker.io/greytimelabs/kura-vault-web
```

The [self-hosting guide](https://github.com/greytimelabs/kura-vault/blob/main/docs/self-hosting.md)
covers manual setup, external buckets (AWS S3, Cloudflare R2), reverse proxy
examples, backups and upgrades.

## Tags

| Tag | Meaning |
|---|---|
| `1.2.3` | An exact release. **Pin this** in production |
| `1.2`, `1` | The latest release in that minor or major line |
| `latest` | The latest stable release |
| `1.3.0-rc.1` | A prerelease, published under its own tag only |

Images are built for `linux/amd64` and `linux/arm64`, only from release tags.
Read the [changelog](https://github.com/greytimelabs/kura-vault/blob/main/CHANGELOG.md)
before upgrading: steps you must take are marked **Action**.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `PUBLIC_URL` | yes | The `https://` origin users open. Signed links, CORS and the cookie's `Secure` flag follow it |
| `JWT_SECRET` | yes | Signs access tokens. 32+ random characters |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | yes | Database connection |
| `POSTGRES_SSL` | | `disable` (default), `require` or `verify-full` |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | yes | Object storage credentials |
| `S3_BUCKET_NAME` | yes | Bucket for the encrypted blobs |
| `S3_ENDPOINT` | | Storage endpoint. Empty for AWS S3 |
| `S3_PUBLIC_ENDPOINT` | | Where browsers reach storage, if different from `S3_ENDPOINT` |
| `SETUP_KEY` | | Creates the owner account on first start. Useless once it exists |
| `CORS_ORIGINS` | | Extra origins allowed to call the API |
| `THROTTLE_LIMIT` | | API requests per minute per client (default `100`) |
| `TRUST_PROXY` | | Proxy hops trusted for the client address (default `1`) |
| `MIGRATIONS_RUN` | | Run database migrations at start (default `true`) |

Secrets can also be read from files: `JWT_SECRET_FILE`, `POSTGRES_PASSWORD_FILE`,
`AWS_ACCESS_KEY_ID_FILE`, `AWS_SECRET_ACCESS_KEY_FILE` and `SETUP_KEY_FILE`.
The server checks its whole configuration at start. If anything is wrong, it
refuses to run and says why.

## The image

- **Contents:** Node.js 24 on Alpine. No npm, corepack or yarn.
- **Process:** runs as an unprivileged user (uid 1001) under `tini`, and works
  with a read-only root filesystem (it needs only a `/tmp` tmpfs).
- **Port:** listens on `3000`. The health check is `GET /api/v1/health`, which
  also reports the server version.
- **Scanning:** every build is scanned for known vulnerabilities in CI.

## Links

- Source and issues: https://github.com/greytimelabs/kura-vault
- Security model: https://github.com/greytimelabs/kura-vault/blob/main/docs/security.md
- Reporting a vulnerability: https://github.com/greytimelabs/kura-vault/blob/main/SECURITY.md
- License: MIT
