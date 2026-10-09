# 0005 — Accounts, per-user keypairs and zero-knowledge sharing

> **Decision record, October 2026.** Written before the work was done, as the plan it was built from.
> The current description is in [architecture](../architecture.md), [cryptography](../crypto/README.md) and [security](../security.md).
> Two things changed during the work and are noted at the end.

## Context

Today a vault is a passphrase: whoever knows it derives the KEK and reads everything, users
self-register with an invite code, `GET /vaults` returns every vault to every user, and the
owner/viewer split only limits writes. There is no way to share without handing over the
passphrase, and no way to take access back.

This change replaces that with owner-managed accounts, a keypair per user, and vault/album
sharing done by re-wrapping keys on the client. The server keeps holding only ciphertext and
wrapped keys.

Decisions taken with the user:

| Topic | Decision |
|---|---|
| Secrets | Login password (API) + master passphrase (keypair) + one passphrase per own vault |
| Keypair | Random; private keys stored only encrypted under Argon2id(master passphrase) |
| Own vault unlock | Master passphrase first, then vault passphrase (two layers; keeps hidden vaults) |
| Shared items | Open through the recipient's keypair only; vault passphrase is never shared |
| Who shares | The vault's creator; recipients cannot re-share |
| Revocation | Server cut-off only (delete wrapped keys, block API). No key rotation yet |
| Recovery | None |
| Existing data | Clean break, no migration of old vaults |
| Scope | Backend, web, Flutter app and migration CLI together |

Two deliberate deviations from the original description, both needed for it to work:

1. **File keys are not wrapped with a user's public key.** Chain is file key → album/vault key
   (AES) → per-user public key. Wrapping each file key per user would make sharing and every
   upload cost one operation per member per file.
2. **An album key is also wrapped under its vault key.** That is what lets a vault member read
   every album. A file gets a vault wrap whenever the uploader holds the vault key; an
   album-only writer cannot, so their uploads carry the album wrap only and vault members reach
   them via vault key → album key → file key.

## Key hierarchy

```
master passphrase ─Argon2id(user salt)─► MK ─AES-GCM─► private bundle {X25519 sk, Ed25519 sk, owner sign pk}
vault passphrase  ─Argon2id(grant salt)─► KEKv

Kv (random, per vault)
  creator's grant   = Seal(PK_creator, AES-GCM(KEKv, Kv))      two layers
  recipient's grant = Seal(PK_recipient, Kv) + Ed25519 signature by the sharer
Ka (random, per album)
  in vault          = AES-GCM(Kv, Ka)
  album share grant = Seal(PK_recipient, Ka) + signature by the sharer
Kc (random, per file)
  vault wrap        = AES-GCM(Kv, Kc)      when the uploader holds Kv
  album wrap        = AES-GCM(Ka, Kc)      one per album the file is in
  encrypts thumb / preview / original / metadata JSON
```

Primitives (Argon2id and AES-256-GCM parameters unchanged from `docs/crypto/README.md`):

- **Seal**: ephemeral X25519 → HKDF-SHA256(shared, salt = ephPk‖recipientPk, info = `kura/seal/v1`)
  → AES-256-GCM. Output `ephPk(32) ‖ iv(12) ‖ ct ‖ tag`. Reject an all-zero shared secret.
- **Signatures**: Ed25519.
- **AAD on every wrap** (new; today there is none): a domain string plus the ids involved, e.g.
  `kura/v1/media-key|{mediaId}|{vaultId}`, and `{mediaId}|{tier}` on blobs. Stops the server
  moving a wrapped key or blob to another row.
- Vault label → Kv. Album name → Ka (album-only members must read it). Metadata → Kc.
- `kek_verify` is dropped; the GCM tag of the passphrase layer is the check.

### Public-key trust (the part a compromised server would attack)

The server distributes public keys, so it could substitute one and receive a vault key. Closed
without manual fingerprint checks:

1. Invite link = `<web>/join#v1.<base64url{server, inviteId, secret S, ownerSignPk}>`. The
   fragment never reaches the server. Server stores only `SHA-256(HKDF(S,"auth"))`.
2. Invitee generates keys, uploads public keys plus
   `binding = HMAC(HKDF(S,"bind"), userId‖username‖encPk‖signPk)`, and stores `ownerSignPk`
   inside their encrypted private bundle (trust root on every device).
3. Owner's client keeps S encrypted to itself in the invite row. On next unlock it checks the
   binding and signs a certificate over `userId‖username‖encPk‖signPk` → `users.key_cert`.
4. Every client verifies the recipient's certificate against the trusted owner key before
   sealing, and verifies the sharer's signature on a grant before using it (blocks the server
   injecting a key it knows to a write user). Uncertified users cannot be shared with.

Limit to document: whoever opens an invite link first becomes that user. Links are single use,
expire in 24 h (`INVITE_CODE_EXPIRY_HOURS`), and the owner sees the join.

## Accounts and permissions

- `users`: `username` only (drop `name`); `role` owner|member; `access_level` full|limited;
  `status` active|restricted. Partial unique index: one owner.
- **Setup key**: on boot with no owner, use `SETUP_KEY` env (≥32 chars) or generate one and
  print it once in a banner. Held hashed in memory, regenerated each boot until an owner exists.
  `GET /health` gains `setupRequired`. `POST /setup` is constant-time, rate limited, and creates
  the owner in a transaction. `POST /auth/register` is removed.
- **full**: may create vaults. **limited**: cannot; may create albums in a vault where they hold
  write. Downgrading keeps existing vaults.
- Per resource: vault write = upload, create/rename albums, add/remove album media. Album write =
  upload into that album. View = read and like. Managing members = vault creator only.
- **Restrict**: set status, revoke all refresh tokens, delete every grant shared to them
  (`jwt.strategy.ts` already checks the user on each request, so it is immediate). Unrestrict
  restores login; shares must be granted again. Their own vaults stay, unreachable.
- **Unshare**: delete the grant row.
- Client rejects a password equal to the master passphrase.

## Backend (`backend/src`)

Clean break: delete both files in `database/migrations/` and write one new initial migration.

| Table | Change |
|---|---|
| `users` | as above + `kdf_salt`, `encrypted_private_keys`, `private_keys_nonce`, `public_enc_key`, `public_sign_key`, `enc_key_sig`, `key_cert` |
| `user_invites` (replaces `invite_codes`) | `username`, `access_level`, `token_hash`, `owner_secret_encrypted`, `key_binding`, `expires_at`, `used_at`, `user_id` |
| `vaults` (was `key_groups`) | drop `kek_*`; add `created_by` |
| `vault_members` (was `user_vault_access`) | `role` creator|member, `permission` view|write, `wrapped_key`, `kdf_salt` (creator), `granted_by`, `grant_sig` |
| `albums` | + `key_wrapped`, `key_nonce`, `created_by` |
| `album_members` (new) | `permission`, `wrapped_key`, `granted_by`, `grant_sig` |
| `media` | + `vault_id`, `uploaded_by`, `key_wrapped_vault`, `key_nonce_vault` (nullable), `encrypted_meta`, `meta_nonce` |
| `album_media` | + `key_wrapped`, `key_nonce` (null for Liked albums) |
| `media_vault_access` | removed, with `POST /media/:id/vault-access` |

Code:

- New `common/access/access.service.ts`: one `resolve(userId, {vaultId?, albumId?, mediaId?})`
  → `{canView, canWrite, isCreator}`. Replaces every `@Roles(UserRole.OWNER)` on media and album
  routes and the `permission !== 'admin'` checks in `media.service.ts` / `album.service.ts`.
  `RolesGuard` stays for owner-only user management.
- New `modules/setup/` and `modules/user/user.controller.ts|service.ts`:
  `POST /setup`; `GET|POST /invites/:id[/accept]`; `GET /me`, `PUT /me/password`, `PUT /me/keys`;
  owner: `GET /users`, `POST|DELETE /users/invites`, `PATCH /users/:id`, `PUT /users/:id/cert`;
  `GET /users/directory` (owner and full users: id, username, public keys, cert).
- `vault.service.ts`: `listVaults(userId)` returns only the caller's grants; create checks
  access level; `GET|POST|PATCH|DELETE /vaults/:id/members`.
- `album.service.ts`: members endpoints, `GET /albums/shared`, add-media takes the album wrap;
  removing a file whose only wrap is that album requires a vault wrap in the request.
- `media.service.ts`: upload takes `vaultId`, optional `albumId` and the wraps; server requires
  at least one wrap matching the caller's write scope; queries return the wrap for the scope
  asked; URL issuance goes through `AccessService`.
- `auth.service.ts`: drop `register`; reuse lockout, dummy-bcrypt and token rotation as is; add
  `revokeAllSessions(userId)`.
- Specs: rewrite `auth/vault/media` specs; add an access-matrix spec for `AccessService`.

## Web (`web/src`)

- `lib/crypto/`: new `identity.ts` (X25519/Ed25519 via WebCrypto, seal/open, sign/verify,
  bundle), `aesgcm.ts` gains AAD, `vaultCrypto.ts` reworked. `crypto.worker.ts` becomes a
  keyring: identity keys (non-extractable), vault keys, album keys, file-key cache. Raw key
  bytes still never cross `protocol.ts`; re-wrapping for a share happens inside the worker.
  Feature-detect X25519/Ed25519 and show an unsupported-browser message.
- `lib/session.ts`: `unlockAccount(passphrase)`, `findVaultMatches` (own grants only), `lock`
  clears the whole keyring; on unlock the owner's client certifies pending users.
- Pages: `SetupPage` (setup key), `JoinPage` (invite link), master unlock step before
  `UnlockPage`, `UsersPage` (owner), `ShareDialog` for vault and album, shared-with-me list.
  Remove `RegisterPage.tsx` and `settings/InviteDialog.tsx`.
- `state/preferences.ts`: auto-lock default 15, options 1/5/15; remove "never" and 60.
- `scripts/gen-vectors.ts`: add seal (fixed ephemeral key), signature, bundle, both vault grant
  forms, album wrap, media wraps with AAD, invite binding.

## Flutter (`app/lib`)

- **Fix `core/crypto/crypto_service.dart` `_getSecureRandom`**: it seeds Fortuna from the clock,
  so keys are predictable. Seed from `Random.secure()`.
- Add the `cryptography` package for X25519/Ed25519/HKDF (pointycastle lacks them; confirm at
  implementation). AAD through the existing `AEADParameters`.
- `blocs/crypto/vault_crypto_cubit.dart` → keyring with the same operations as the web worker;
  zeroing as today. `cache_crypto.dart` derives the cache key from Kv or Ka via HKDF.
- Screens mirroring web: setup, join (pasted link, plus deep link), master unlock, users, share.
- Lock after 15 min without input and on app detach; compare timestamps on resume.

## Migration CLI (`migration-cli/src`)

Prompt for password, master passphrase and vault passphrase; `encryptor.ts` gains identity
unlock, AAD and the new wraps (Node `crypto` X25519/HKDF); `api-client.ts` follows the new
upload payload. No setup or sharing commands.

## Docs

Update `docs/security.md` (new rules: public-key trust, AAD, revocation limit, setup key logged
once), `docs/architecture.md`, `docs/crypto/README.md`, `docs/database/schema.dbml` + README,
`docs/getting-started.md`; add `docs/design/0005-accounts-keys-sharing.md`.

## Order of work

1. Crypto spec + web crypto library + regenerated `crypto-vectors.json`.
2. Backend schema, access service, endpoints, specs.
3. Web flows.
4. Flutter (RNG fix first), then CLI, both against the same vectors.
5. Docs.

The working tree has ~60 uncommitted files (username rename, multi-server). Commit that first
so this lands as its own change.

## Not in this change

Key rotation or re-encryption on revoke; recovery key; deleting users, vaults or media; owner
resetting another user's password; moving a file between vaults.

## Verification

- `pnpm test` in `web/` and `migration-cli/`, `flutter test` in `app/`: all three pass the same
  new vectors.
- `pnpm test` in `backend/`: access matrix (owner / full / limited × creator / vault view /
  vault write / album view / album write / none / restricted) on every media, album and vault
  route.
- Playwright (`web/tests/e2e/journey.spec.ts`, real backend via `start-backend.ts`): setup key →
  owner → invite → join → owner certifies → vault shared view-only (recipient sees media, upload
  refused) → album shared with write (recipient uploads, vault creator sees it) → limited user
  cannot create a vault → restrict user, next request is 401 and grants are gone from the DB.
- Adversarial: swap a user's `public_enc_key` in the DB and confirm the share dialog refuses;
  insert a forged grant and confirm the client rejects it; move a wrapped key to another row and
  confirm decryption fails.
- Manual: idle 15 min locks web and app; closing the tab or app leaves no usable key; Postgres
  dump contains no unwrapped key.

## Changed during the work

- **`enc_key_sig` was not needed.** The owner's certificate covers both of a user's public keys, so there is no separate signature over the encryption key.
- **The mobile app has no user-management or share screens yet.** It is a viewer: it sets up, joins, unlocks, and opens own and shared vaults and albums. Its keyring already implements inviting, certifying and sharing; the screens are not built.
