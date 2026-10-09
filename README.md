# Kura Vault

Self-hosted, end-to-end encrypted storage for personal photos and videos.

Media is encrypted on the device before it is uploaded. The server stores
opaque blobs in S3-compatible object storage and encrypted keys in PostgreSQL;
it never sees a passphrase, a key, or a decrypted file.

> **Status:** early and under active development. It has not had an
> independent security review. Do not make it the only copy of anything you
> care about.

## What it does

- **Client-side encryption.** AES-256-GCM with a random key per file, wrapped
  by a vault key derived from your passphrase with Argon2id.
- **Multiple vaults.** Each vault has its own passphrase. Entering a passphrase
  opens only the vaults it matches.
- **Shared media without duplication.** One encrypted blob can belong to
  several vaults; only its small wrapped key is stored per vault.
- **Direct-to-storage transfers.** Uploads and downloads use short-lived
  pre-signed URLs, so media bytes never pass through the API.
- **Family sharing.** The owner invites other devices to a vault with one-time
  invite codes; invited devices are read-only viewers.
- **Bulk import.** A CLI encrypts and uploads an existing library with resume.

## Repository layout

| Path | What it is | Stack |
|---|---|---|
| [`backend/`](backend) | REST API: auth, vaults, media, albums, pre-signed URLs | NestJS, TypeORM, PostgreSQL |
| [`web/`](web) | Browser client | React, TypeScript, Vite |
| [`app/`](app) | Mobile client | Flutter (BLoC) |
| [`migration-cli/`](migration-cli) | Bulk encrypt-and-upload tool | Node.js |
| [`crypto-vectors.json`](crypto-vectors.json) | Shared test vectors that keep the three clients byte-compatible | |
| [`docs/`](docs) | All project documentation | |

## Quick start

Requires Node.js 24, pnpm, Docker, and an S3-compatible bucket (AWS S3 or
Cloudflare R2).

```bash
# 1. Database
cp .env.example .env
docker compose up -d                 # PostgreSQL on localhost:5433

# 2. API
cd backend
cp .env.example .env                 # then fill in JWT_SECRET and storage credentials
pnpm install
pnpm migration:run
pnpm start:dev                       # http://localhost:3000/api/v1

# 3. Web client (new terminal)
cd web
pnpm install
pnpm dev                             # http://localhost:5173
```

The first device to register becomes the owner. Full instructions, including
the mobile app, the import CLI and the tests, are in
[docs/getting-started.md](docs/getting-started.md).

## Documentation

- [Getting started](docs/getting-started.md): run every component locally
- [Architecture](docs/architecture.md): components, data flow, API surface
- [Cryptography](docs/crypto/README.md): algorithms, key hierarchy, wire format
- [Security model](docs/security.md): what is and is not protected
- [Database](docs/database/README.md): schema and known gaps
- [Design records](docs/design): why things are the way they are
- [Full index](docs/README.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, follow
[SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE)
