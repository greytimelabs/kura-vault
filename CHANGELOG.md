# Changelog

Notable changes for people running a server. Anything you must do when
upgrading is marked **Action**. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `upgrade.sh`, published with each release next to `install.sh`: it moves a
  deployment to another release, checking the files against `SHA256SUMS` and
  backing up the database and `.env` before it changes anything.

## [1.0.6] - 2026-10-23

## [1.0.5] - 2026-10-15

## [1.0.4] - 2026-10-15

## [1.0.3] - 2026-10-15

## [1.0.2] - 2026-10-15

### Added

- A workflow that deploys the web client, built in multi-server mode, to
  Cloudflare Pages for each release tag. It runs only when configured.
- Documentation for hosting the web client apart from the server, and for
  running the server without the `web` container.

## [1.0.1] - 2026-10-14

## [1.0.0] - 2026-10-14

### Added

- Published images, `ghcr.io/greytimelabs/kura-vault-server` and
  `ghcr.io/greytimelabs/kura-vault-web`, for amd64 and arm64, published for
  each release tag. A Docker Hub mirror is published when configured.
- A `deploy/` bundle attached to each release: Docker Compose file, example
  environment, optional bundled Garage storage served from the server's own
  address, and an installer that verifies checksums and generates secrets.
- `PUBLIC_URL`: the address users open. Signed storage links, CORS and the
  refresh cookie's `Secure` flag follow it.
- `POSTGRES_SSL` (`disable`, `require`, `verify-full`) and `POSTGRES_SSL_CA_FILE`.
- `MIGRATIONS_RUN`: run database migrations at start (on in the image).
- `TRUST_PROXY`, so rate limiting and lockout see client addresses behind a proxy.
- `S3_PUBLIC_ENDPOINT`, for storage reached at a different address by browsers
  than by the server.
- `*_FILE` variants for secrets (`JWT_SECRET_FILE` and others).
- The health endpoint reports the server `version`.

### Changed

- **Action:** an unset `NODE_ENV` now means `production`, which requires
  `PUBLIC_URL`. Development setups set `NODE_ENV=development` (as in
  `backend/.env.example`).
- **Action:** database TLS is no longer switched on by `NODE_ENV=production`.
  Set `POSTGRES_SSL=verify-full` (or `require`) if your database needs it.
- **Action:** the refresh cookie's `Secure` flag follows `PUBLIC_URL` instead of
  `NODE_ENV`. Set `PUBLIC_URL=https://...` on any deployed server.
- HSTS no longer sends `preload` or `includeSubDomains`, which reached beyond the
  server. `HSTS_INCLUDE_SUBDOMAINS=true` restores the latter.
- Storage credentials are required at start, instead of failing at the first upload.
- The web image no longer bakes the bucket origin into the page. Its
  Content-Security-Policy is sent by nginx and set at run time with `S3_ORIGIN`.
  The `VITE_S3_ORIGIN` build argument is gone from the image.

### Fixed

- The server image's health check probed `/health` instead of `/api/v1/health`,
  so it never reported healthy.
- nginx dropped the security headers (Content-Security-Policy, HSTS, `nosniff`)
  on the app shell and assets, because those locations set their own headers.
- nginx resolved the API's address once at start, so a recreated server
  container was unreachable until the web container restarted.

### Removed

- The unused CloudFront and `S3_PRESIGNED_EXPIRY` settings.

[Unreleased]: https://github.com/greytimelabs/kura-vault/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/greytimelabs/kura-vault/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/greytimelabs/kura-vault/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/greytimelabs/kura-vault/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/greytimelabs/kura-vault/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/greytimelabs/kura-vault/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/greytimelabs/kura-vault/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/greytimelabs/kura-vault/releases/tag/v1.0.0
