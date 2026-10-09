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
| `backend/` | Authenticates accounts, enforces who can reach which vault and album, stores wrapped keys and structural metadata, hands out pre-signed storage URLs. Never handles media bytes. |
| `web/` | Browser client. Keys live only inside a dedicated Web Worker. |
| `app/` | Flutter mobile client, BLoC state management. A viewer: it does not upload or manage users. |
| `migration-cli/` | One-off bulk import of an existing library. |
| PostgreSQL | Ten tables; see [database](database/README.md). |
| Object storage | AWS S3 or any S3-compatible service such as Cloudflare R2. |

## Concepts

**User.** An account on one server: a username, a password, and a key pair
whose private half is encrypted under the user's master passphrase. There is
no sign-up. The **owner** is created once with the server's setup key and
manages the other users; each of them joins from an invite link the owner
made. A user has **full** access (may create vaults of their own) or
**limited** access (only what is shared with them). At most 10 users per
server.

**Server and account.** Clients are not tied to a server. The mobile app, and
the web client in its multi-server build, ask for a server address, confirm it
with `GET /health`, and keep one **account** (server address + username) per
sign-in. Several accounts can be signed in at once; one is active, and
switching locks everything. Passwords are never stored.

**Vault.** A compartment with a random key. Its creator's copy of the key is
encrypted under the vault's own passphrase and then sealed to their public
key, so the vaults a user created are never listed: typing a vault passphrase
opens the ones it matches. A vault's creator can **share** it with other
users, for viewing or for viewing and adding; the vault key is sealed to each
recipient's public key and the passphrase is never shared. The owner account
has no access to a vault that was not shared with it.

**Album.** A named collection inside one vault, with a key of its own wrapped
under the vault key, so vault members open every album. The vault's creator
can share **one album** without the rest of the vault. Each user also has a
private **Liked** album per vault.

**Media.** One photo or video in one vault, stored as three separately
encrypted blobs at `{vaultId}/{mediaId}/{tier}.enc`:

| Tier | Use |
|---|---|
| `thumb` | Grid views |
| `preview` | Single-item viewing |
| `original` | Full-resolution download |

**Envelope encryption.** Each item has its own random key, stored wrapped
under the vault key and under the key of each album it is in. Nothing is ever
re-encrypted to share it: sharing a vault or an album is one sealed key per
recipient.

**Permissions.** What a user may do comes from two tables and nothing else:

| Holds | May |
|---|---|
| Vault, as creator | Everything below, and share the vault and its albums |
| Vault, write | Upload, create and rename albums, move items between albums |
| Vault, view | See everything in the vault; like |
| One album, write | See the album; upload into it |
| One album, view | See the album; like |

Details of the algorithms and formats are in [crypto](crypto/README.md).

## Flows

### First run

1. A server with no owner prints a **setup key** at start (or takes one from
   `SETUP_KEY`). `GET /health` reports `setupRequired: true`.
2. A client generates the owner's key pair, encrypts the private half under
   the master passphrase, signs the owner's own certificate, and sends the
   setup key with the public material to `POST /setup`.
3. The setup key stops working. Nothing else creates an owner.

### Adding a user

1. The owner names the user and their access level. The client makes a random
   secret, sends `POST /users/invites` a hash of a token derived from it and a
   copy sealed to the owner, and shows the invite link:
   `<web>/join#v1.<server, invite id, secret, owner's signing key>`.
2. The invitee opens the link, chooses a password and a master passphrase,
   and their client generates their keys, binds them to the link's secret and
   calls `POST /invites/:id/accept`.
3. The next time the owner's client is unlocked it checks that binding and
   signs the user's certificate (`PUT /users/:id/cert`). Until then nothing
   can be shared with the user.

### Unlock

1. The client signs in with a username and password and receives a short-lived
   access token and a refresh token.
2. The user types the **master passphrase**. The client fetches the account's
   encrypted private keys (`GET /me`) and decrypts them. A wrong passphrase
   fails on the device.
3. The client fetches the vaults and albums shared with the account, verifies
   each share, and lists the ones that verify. They open with one tap.
4. For a vault the user created, the user types its **vault passphrase**. The
   client tries it against every vault the account created; the ones it opens
   are the result. If more than one opens, the user picks one.

The server takes no part in steps 2 to 4 and cannot tell which passphrase was
typed.

### Upload

1. The client makes a thumbnail and a preview.
2. `POST /media/upload/init` returns a media id and three pre-signed PUT URLs
   (valid 15 minutes). The id comes first because everything encrypted next is
   bound to it.
3. The client generates the item's key, encrypts all three tiers and the
   metadata, and uploads the encrypted blobs straight to the bucket.
4. `POST /media/upload/complete` stores the structural metadata, the IVs and
   the item's key wrapped under the vault key, the album key, or both.

### View

1. `GET /media?vaultId=…` (or `?albumId=…` for someone who has only the
   album) returns a page of items, each with its key as the caller can unwrap
   it and a pre-signed thumbnail URL (valid 60 seconds).
2. The client fetches each encrypted thumbnail from the bucket, unwraps the
   item's key and decrypts locally.
3. `GET /media/:id/urls` returns fresh URLs for the larger tiers when an item
   is opened.

### Share and unshare

1. The creator's client checks the recipient's certificate, seals the vault or
   album key to their public key, signs the result, and calls
   `POST /vaults/:id/members` or `POST /albums/:id/members`.
2. Removing a member, or the owner restricting a user, deletes the wrapped
   keys. The user's next request is refused; restricting also ends every
   session. See [security](security.md) for what this does not do.

### Lock

The client destroys every key, the account's private keys included, and
everything decrypted with them. In the web client that means terminating the
crypto worker, revoking object URLs and clearing the query cache. It happens
after 15 minutes without input, when the tab or app is closed, and on demand.
**Closing** a vault is lighter: the account stays unlocked and a vault opened
with a passphrase needs it again.

## API surface

All routes are under `/api/v1`. Everything except `health`, `setup`,
`invites`, `login` and `refresh` needs a bearer access token. **owner** means
the server owner; the rest are decided per vault and album as in the table
above.

| Method and path | Purpose | |
|---|---|---|
| `GET /health` | Liveness check; whether setup is still needed | public |
| `POST /setup` | Create the owner with the setup key, once | public |
| `GET /invites/:id`, `POST /invites/:id/accept` | Read and accept an invite link | public |
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` | Sessions | |
| `GET /me` | The account and its encrypted private keys | |
| `PUT /me/password`, `PUT /me/keys` | Change the password; re-encrypt the keys under a new master passphrase | |
| `GET /users`, `PATCH /users/:id` | List users; change access level, restrict or lift | owner |
| `POST /users/invites`, `DELETE /users/invites/:id` | Create or cancel an invite | owner |
| `PUT /users/:id/cert` | Store the certificate the owner's client signed | owner |
| `GET /users/directory` | Certified users something can be shared with | owner, full |
| `GET /vaults` | The caller's own vaults and those shared with them | |
| `POST /vaults` | Create a vault | owner, full |
| `GET/POST /vaults/:id/members`, `PATCH/DELETE …/:userId` | Share a vault | creator |
| `POST /media/upload/init`, `/media/upload/complete` | Upload | write |
| `GET /media` | Page through a vault or an album | view |
| `GET /media/:id/urls` | Download URLs for one item | view |
| `PUT /media/:id/vault-key` | Add the vault-wrapped key to an item uploaded through an album | vault write |
| `GET /albums`, `GET /albums/shared` | Albums of a vault; albums shared on their own | view |
| `POST /albums`, `PUT /albums/:id` | Create, rename | vault write |
| `POST /albums/:id/media`, `DELETE …/:mediaId` | Add or remove an item | vault write |
| `GET/POST /albums/:id/members`, `PATCH/DELETE …/:userId` | Share one album | creator |
| `PUT/DELETE /albums/liked/media/:mediaId` | Like, unlike | view |

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
same origin. The multi-server web build cannot use a cookie across sites, so
it omits the header, behaves like a native client and keeps the refresh token
in browser storage.

## What is not built yet

- Deleting media, albums, vaults or users (no endpoints).
- Re-keying a vault or album when someone's access is removed.
- User management and sharing in the mobile app (its keyring supports both).
- A screen for changing the password or master passphrase (the endpoints exist).
- Recovery of a forgotten master passphrase.
- In-browser video playback.
- CloudFront delivery: the settings exist in config, but downloads use S3
  pre-signed URLs.
- Database seeds. The server's rules are tested end to end from
  `web/tests/api/`, not from `backend/test/`.
