# Architecture

Kura Vault is a zero-knowledge media store: clients do all the cryptography,
and the server coordinates storage and access without being able to read
anything it holds.

## Components

```
 ┌────────────┐  ┌────────────┐  ┌───────────────┐
 │ web/       │  │ app/       │  │ migration-cli/│      clients: hold the passphrase,
 │ React      │  │ Flutter    │  │ Node.js       │      derive keys, encrypt and decrypt
 └─────┬──────┘  └─────┬──────┘  └───────┬───────┘
       │  JSON: encrypted keys, metadata, pre-signed URLs
       ▼               ▼                 ▼
 ┌──────────────────────────────────────────────┐
 │ backend/  NestJS API  (/api/v1)              │      auth, vault access checks,
 └───────┬──────────────────────────────┬───────┘      issues pre-signed URLs
         │                              │
         ▼                              ▼ signs URLs only
 ┌───────────────┐              ┌────────────────────┐
 │ PostgreSQL    │              │ S3-compatible      │◄──── clients PUT and GET
 │ wrapped keys, │              │ bucket             │      encrypted blobs directly
 │ structure     │              │ encrypted blobs    │
 └───────────────┘              └────────────────────┘
```

| Component | Role |
|---|---|
| `backend/` | Authenticates devices, enforces who can reach which vault, stores wrapped keys and structural metadata, hands out pre-signed storage URLs. Never handles media bytes. |
| `web/` | Browser client. Keys live only inside a dedicated Web Worker. |
| `app/` | Flutter mobile client, BLoC state management. |
| `migration-cli/` | One-off bulk import of an existing library. |
| PostgreSQL | Nine tables; see [database](database/README.md). |
| Object storage | AWS S3 or any S3-compatible service such as Cloudflare R2. |

## Concepts

**Device.** The unit of authentication. A device registers with an id and a
password; the `users` table is really a table of devices. The first device to
register is the **owner**; every later device needs an invite code and becomes
a **viewer**. At most 10 devices.

**Vault.** A compartment with its own passphrase (`key_groups` in the
database). The passphrase derives the vault's key-encryption key (KEK) on the
client. The server stores a salt and a verification token, never the
passphrase or the KEK.

**Media.** One photo or video, stored as three separately encrypted blobs at
`{vaultId}/{mediaId}/{tier}.enc`:

| Tier | Use |
|---|---|
| `thumb` | Grid views |
| `preview` | Single-item viewing |
| `original` | Full-resolution download |

**Envelope encryption.** Each media item has its own random data-encryption
key (DEK). The DEK is wrapped with a vault's KEK and stored in
`media_vault_access`. Putting one item in a second vault means storing one
more wrapped copy of the DEK, not a second copy of the blob.

**Album.** A named collection inside one vault. The name is encrypted. Each
device also has a private **Liked** album per vault.

Details of the algorithms and formats are in [crypto](crypto/README.md).

## Flows

### Unlock

1. The device signs in with its id and password and receives a short-lived
   access token and a refresh token.
2. The client fetches the vaults the device can access (salt and verification
   token for each).
3. The user types a passphrase. For each vault the client derives a KEK and
   tries to decrypt the verification token. A vault opens only if the result
   equals its own id.
4. If more than one vault matches, the user picks one.

The server takes no part in step 3 and cannot tell which passphrase was typed.

### Upload

1. The client makes a thumbnail and a preview, generates a DEK, and encrypts
   all three tiers and the metadata.
2. `POST /media/upload/init` returns a media id and three pre-signed PUT URLs
   (valid 15 minutes).
3. The client uploads the encrypted blobs straight to the bucket.
4. `POST /media/upload/complete` stores the structural metadata, the IVs and
   the DEK wrapped with the vault's KEK.

### View

1. `GET /media?vaultId=…` returns a page of items with their wrapped DEKs and
   pre-signed thumbnail URLs (valid 60 seconds).
2. The client fetches each encrypted thumbnail from the bucket, unwraps the
   DEK with the KEK and decrypts locally.
3. `GET /media/:id/urls?vaultId=…` returns fresh URLs for the larger tiers
   when an item is opened.

### Lock

The client destroys its keys and everything decrypted with them. In the web
client that means terminating the crypto worker, revoking object URLs and
clearing the query cache. It locks automatically after a configurable idle
period.

## API surface

All routes are under `/api/v1`. Everything except `health`, `register`,
`login` and `refresh` needs a bearer access token. Routes marked **owner** are
refused for viewers.

| Method and path | Purpose | |
|---|---|---|
| `GET /health` | Liveness check | |
| `POST /auth/register` | Register a device | |
| `POST /auth/login` | Sign in | |
| `POST /auth/refresh` | Rotate the refresh token | |
| `POST /auth/logout` | Revoke the session | |
| `GET /vaults` | Vaults this device can access | |
| `POST /vaults` | Create a vault | owner |
| `POST /vaults/:id/invite` | Create a one-time invite code (valid 24 hours) | owner |
| `POST /media/upload/init` | Reserve a media id, get upload URLs | owner |
| `POST /media/upload/complete` | Record an uploaded item | owner |
| `GET /media` | Page through a vault (`vaultId`, optional `albumId`, `yearMonth`, `page`, `limit`) | |
| `GET /media/:id/urls` | Download URLs for one item | |
| `POST /media/:id/vault-access` | Add an item to another vault | owner |
| `GET /albums` | Albums in a vault | |
| `POST /albums` | Create an album | owner |
| `PUT /albums/:id` | Update an album | owner |
| `POST /albums/:id/media` | Add items to an album | owner |
| `DELETE /albums/:id/media/:mediaId` | Remove an item from an album | owner |
| `PUT /albums/liked/media/:mediaId` | Like an item | |
| `DELETE /albums/liked/media/:mediaId` | Unlike an item | |

Controllers are in `backend/src/modules/*/*.controller.ts`; request shapes are
the DTO classes next to them.

Cross-cutting behaviour, set up in `backend/src/main.ts` and `app.module.ts`:
Helmet security headers, CORS limited to configured origins, strict input
validation that rejects unknown fields, a global rate limit (100 requests per
minute by default), a correlation id on every request, and a response wrapper
plus an exception filter that never returns stack traces.

### Sessions

Access tokens last 15 minutes. Refresh tokens last 7 days, are stored only as
SHA-256 hashes and are rotated on every use. Native clients hold the refresh
token themselves. Web clients send `X-Client: web` and receive it as an
httpOnly, `SameSite=Strict` cookie scoped to `/api/v1/auth`, so page scripts
can never read it; this is why the web client and the API are served from the
same origin.

## What is not built yet

- Deleting media or albums (no endpoints).
- A UI for adding an item to a second vault (the endpoint exists).
- In-browser video playback.
- CloudFront delivery: the settings exist in config, but downloads use S3
  pre-signed URLs.
- Backend end-to-end tests and database seeds (`backend/test/` and
  `backend/src/database/seeds/` are empty).
