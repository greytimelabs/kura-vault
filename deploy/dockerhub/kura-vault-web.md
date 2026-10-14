# Kura Vault web

The browser client for [Kura Vault](https://github.com/greytimelabs/kura-vault):
self-hosted, end-to-end encrypted storage for personal photos and videos.

All encryption and decryption happens in the browser. This image serves the
client with nginx and is the single entry point of a deployment. It serves the
app, proxies `/api/` to the
[server](https://hub.docker.com/r/greytimelabs/kura-vault-server), and can serve
the bundled storage bucket from the same origin. Your HTTPS reverse proxy points
at this container.

> **Status:** early and under active development. It has not had an independent
> security review. Do not make it the only copy of anything you care about.

## Quick start

Don't run this image on its own. It's one part of a stack: this web client, the
server, PostgreSQL and object storage. The installer sets up all of it with
Docker Compose:

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
covers manual setup, external buckets, reverse proxy examples, backups and
upgrades.

## Tags

| Tag | Meaning |
|---|---|
| `1.2.3` | An exact release. **Pin this** in production, at the same version as the server |
| `1.2`, `1` | The latest release in that minor or major line |
| `latest` | The latest stable release |
| `1.3.0-rc.1` | A prerelease, published under its own tag only |

Images are built for `linux/amd64` and `linux/arm64`, only from release tags.
Always run the web and server images at the same version.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `API_UPSTREAM` | `http://server:3000` | Where the server is reached |
| `S3_PROXY_UPSTREAM` | | Storage to serve at `/<bucket>/`, e.g. `http://garage:3900` for the bundled Garage |
| `S3_BUCKET_NAME` | | The bucket name, when `S3_PROXY_UPSTREAM` is set |
| `S3_ORIGIN` | | An external bucket's origin, allowed in the Content-Security-Policy |
| `TRUSTED_PROXIES` | private ranges | Addresses or CIDRs allowed to set `X-Forwarded-For` |

Every value is checked at start. A bad one stops the container with a message
instead of producing a broken nginx configuration.

## The image

- **Contents:** `nginx-unprivileged` on Alpine.
- **Process:** runs as uid 101, and works with a read-only root filesystem
  (tmpfs at `/tmp`, `/etc/nginx/conf.d` and `/var/cache/nginx`).
- **Port:** listens on `8080`. The health check is `GET /healthz`.
- **Security headers:** a strict Content-Security-Policy, HSTS,
  `nosniff`, `no-referrer` and `frame-ancestors 'none'` on every response.
- **Scanning:** every build is scanned for known vulnerabilities in CI.

## Links

- Source and issues: https://github.com/greytimelabs/kura-vault
- Security model: https://github.com/greytimelabs/kura-vault/blob/main/docs/security.md
- Reporting a vulnerability: https://github.com/greytimelabs/kura-vault/blob/main/SECURITY.md
- License: MIT
