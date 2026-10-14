# Contributing

Thanks for taking an interest. This is a small project, so the process is light.

## Setup

Follow [docs/getting-started.md](docs/getting-started.md). Each component
(`backend/`, `web/`, `migration-cli/`, `app/`) is a separate
package with its own dependencies; there is no workspace root.

## Before opening a pull request

Run the checks for whatever you touched:

| Component | Command |
|---|---|
| `backend/` | `pnpm test` and `pnpm build` |
| `web/` | `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` for UI changes |
| `migration-cli/` | `pnpm test` and `pnpm build` |
| `app/` | `flutter analyze` and `flutter test` |

CI runs all of these, plus the server-rules suite (`pnpm test:api`). It also
builds both images, scans them, and smoke-tests the `deploy/` bundle end to
end. If you change `deploy/`, a Dockerfile or `web/nginx.conf`, run the bundle
locally the way [self-hosting](docs/self-hosting.md) describes, with
`tests/deploy/smoke.ts` in `web/`.

## Releases

Maintainers tag `vX.Y.Z` on `main`. The release workflow then builds and signs
the images for amd64 and arm64, pushes them to GHCR (and Docker Hub when
configured), and attaches the `deploy/` bundle with `SHA256SUMS` to the GitHub
Release. Note anything operators must do in `CHANGELOG.md` before tagging.

## Rules that are not negotiable

- **The three clients must stay byte-compatible.** If you change anything in
  the encryption format, key derivation parameters or encoding, regenerate
  [`crypto-vectors.json`](crypto-vectors.json) and make all three test suites
  pass. See [docs/crypto/README.md](docs/crypto/README.md).
- **The server must never receive plaintext media, passphrases or keys.** Do
  not add an endpoint or log line that would change that.
- **Schema changes go through a TypeORM migration**, and
  [`docs/database/schema.dbml`](docs/database/schema.dbml) is updated in the
  same change. `synchronize` stays off.
- **Never commit credentials.** `.env` files are ignored; only `.env.example`
  files with placeholder values belong in the repository.

The full list of security rules is in [docs/security.md](docs/security.md).

## Documentation

Docs live in [`docs/`](docs). Pages at the top level describe the project as it
is now, so update them with your change. Files under `docs/design/` and
`docs/archive/` are historical records: add a new numbered design record for a
significant decision instead of rewriting an old one.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
