# Cryptography

Three independent implementations must produce and read exactly the same
bytes:

| Client | Code | Primitives from |
|---|---|---|
| Web | `web/src/lib/crypto/` | WebCrypto (AES-GCM, X25519, Ed25519, HKDF), `hash-wasm` (Argon2id) |
| Mobile | `app/lib/core/crypto/` | `pointycastle` (AES-GCM, Argon2id), `cryptography` (X25519, Ed25519, HKDF) |
| Migration CLI | `migration-cli/src/encryptor.ts` | Node `crypto`, `hash-wasm` (Argon2id) |

The server performs no media cryptography at all. It hashes sign-in passwords
and compares hashes of setup and invite tokens; nothing else.

## Key hierarchy

```
master passphrase ──Argon2id(user salt)──► master key ──► private bundle
                                                          { X25519 private key, Ed25519 private key,
                                                            the owner's signing key this account trusts }

vault passphrase ──Argon2id(grant salt)──► passphrase key          (vaults you created only)

vault key   random, one per vault
  ├─ creator's copy    Seal(creator's public key, AES-GCM(passphrase key, vault key))   two layers
  ├─ each recipient    Seal(recipient's public key, vault key), signed by the sharer
  ├─ encrypts ─► vault label
  └─ wraps ────► album key   random, one per album
                   ├─ each recipient   Seal(recipient's public key, album key), signed by the sharer
                   ├─ encrypts ─► album name
                   └─ wraps ────► media key (when the item is in the album)
  └─ wraps ────► media key   random, one per item
                   └─ encrypts ─► thumb, preview, original, metadata
```

Nothing above the bottom line is ever stored unwrapped, and a file key is
never encrypted directly to a user: sharing a vault or an album is one sealed
key per recipient, whatever it contains.

An item's key is wrapped under the vault key when its uploader holds it, and
under the album key for each album the item is in. Someone who has only an
album uploads with the album wrap alone; vault members reach that item through
vault key → album key → media key, and any of them can add the vault wrap later.

## Parameters

**Key derivation: Argon2id**, version 1.3 (`0x13`), for the master passphrase
and for vault passphrases

| Parameter | Value |
|---|---|
| Password | passphrase as UTF-8 |
| Salt | 16 random bytes, stored next to what it protects |
| Iterations | 3 |
| Memory | 65536 KiB (64 MiB) |
| Parallelism | 1 |
| Output | 32 bytes |

**Encryption: AES-256-GCM**

| Parameter | Value |
|---|---|
| Key | 32 bytes |
| IV / nonce | 12 random bytes, fresh for every encryption |
| Additional data | always, see below |
| Output | ciphertext followed by the 16-byte tag |

**Seal** (encrypt to a public key)

1. Generate an ephemeral X25519 key pair.
2. `shared = X25519(ephemeral private, recipient public)`. Reject an all-zero result.
3. `key = HKDF-SHA256(ikm = shared, salt = ephemeral public ‖ recipient public, info = "kura/seal/v1")`, 32 bytes.
4. AES-256-GCM with a random IV and the additional data for the purpose.
5. Output `ephemeral public (32) ‖ IV (12) ‖ ciphertext + tag`.

**Signatures: Ed25519.** Public keys and signatures travel as base64 of the
raw 32 and 64 bytes.

Binary values in API payloads and the database are base64.

## Additional data

Every AES-GCM operation authenticates a string naming what the ciphertext is
and the rows it belongs to, so the server cannot move a wrapped key or a blob
to another user, vault, album or item. All start with `kura/v1/` and join
their parts with `|`:

| Ciphertext | Additional data |
|---|---|
| Private bundle | `user-keys\|{userId}` |
| Vault key, passphrase layer | `vault-key-pass\|{vaultId}\|{userId}` |
| Vault key sealed to a user | `vault-key\|{vaultId}\|{userId}` |
| Vault label | `vault-label\|{vaultId}` |
| Album key under the vault key | `album-key\|{albumId}\|{vaultId}` |
| Album key sealed to a user | `album-key-grant\|{albumId}\|{userId}` |
| Album name | `album-name\|{albumId}` |
| Media key under the vault key | `media-key\|{mediaId}\|vault\|{vaultId}` |
| Media key under an album key | `media-key\|{mediaId}\|album\|{albumId}` |
| A tier of an item | `media-blob\|{mediaId}\|{thumb,preview,original}` |
| Item metadata | `media-meta\|{mediaId}` |
| Invite secret sealed to the owner | `invite-secret\|{inviteId}` |

Because the item id is part of the additional data, a client asks the server
for the id (`POST /media/upload/init`) before it encrypts.

## Whose public key is this?

The server hands out public keys, so it could hand out its own. Two signed
statements stop that, both verified on the client:

- **Certificate.** The owner's signature over
  `cert|{userId}|{username}|{encryption key}|{signing key}`. A client seals a
  key to a user only if their certificate verifies against the owner key it
  trusts. The owner certifies themselves at setup.
- **Grant signature.** The sharer's signature over
  `grant|{vault or album}|{id}|{recipientId}|{sharerId}|{SHA-256 of the sealed key}`.
  A client uses a key shared with it only if the sharer's certificate verifies
  and this signature does. Without it a server could seal a key it knows to a
  user with write access and read what they upload.

A new user's certificate is issued without anyone comparing fingerprints. The
invite link carries a 32-byte secret in its URL fragment, which no server
ever receives:

```
auth token  = HKDF-SHA256(secret, no salt, "kura/v1/invite/auth")    server stores SHA-256 of this
binding key = HKDF-SHA256(secret, no salt, "kura/v1/invite/bind")
binding     = HMAC-SHA256(binding key, "kura/v1/bind|{userId}|{username}|{encryption key}|{signing key}")
```

The invitee uploads the binding with their public keys. The owner's client
kept the secret sealed to itself, recomputes the binding over the keys the
server now reports, and signs the certificate only if they match. The link
also carries the owner's signing key; the invitee stores it inside their
encrypted private bundle, so every device they unlock trusts the same owner
whatever the server says.

## What stays in plaintext

So that the server can sort, paginate and authorise, these are not encrypted:
usernames, who may open which vault and album and with what permission, media
type, capture time and year-month, dimensions, duration, file size, aspect
ratio, and which items belong to which vault and album. See
[security](../security.md) for what that reveals.

## Shared test vectors

[`crypto-vectors.json`](../../crypto-vectors.json) at the repository root holds
fixed inputs and the exact outputs expected for them: derived keys, GCM
ciphertexts with and without additional data, a sealed message, two users with
certificates, a private bundle, an invite token and binding, and a vault with
its creator grant, a share, an album and a media item.

It is **generated** by the web implementation and **checked** by all three:

| Suite | File | Run with |
|---|---|---|
| Web | `web/tests/unit/crypto.test.ts` | `pnpm test` in `web/` |
| CLI | `migration-cli/src/encryptor.test.ts` | `pnpm test` in `migration-cli/` |
| Mobile | `app/test/core/crypto/interop_vectors_test.dart` | `flutter test` in `app/` |

The file stays at the repository root because each suite loads it by relative
path.

### Changing the format

Do not edit the JSON by hand. If you deliberately change a parameter or a
format:

```bash
cd web && pnpm gen:vectors
```

then make all three suites pass before merging. A change that passes in one
client only will produce media the others cannot open. Existing data is not
migrated automatically; a format change needs a plan for what is already
encrypted.

## Client-side key handling

**Web.** Keys exist only inside `crypto.worker.ts`, in one `Keyring`. The page
can call a fixed list of its methods (`CRYPTO_METHODS` in `protocol.ts`), none
of which returns a key. Private keys and passphrase keys are non-extractable
`CryptoKey`s. Vault and album keys are extractable, because sharing has to
re-wrap them, but the key objects never leave the worker. Locking terminates
the worker. IndexedDB caches ciphertext only. A JavaScript string cannot be
wiped, so a passphrase is cleared from its input and never stored, but may
linger in memory until garbage collection.

**Mobile.** Keys are held by `VaultCryptoCubit` and zeroed on lock. Random
bytes come from the operating system (`Random.secure()`). Thumbnails cached on
disk are re-encrypted with a cache key derived from the key of whatever is
open, as `SHA-256(key ‖ "kura-vault-thumbnail-cache")`.

**Both** destroy every key after 15 minutes without input (the web client can
be set lower), when the tab or app is closed, and on Lock.

Background and rationale: [0005](../design/0005-accounts-keys-sharing.md),
[0001 system design](../design/0001-system-design.md) sections 3 and 8, and
[0004](../design/0004-react-web-client.md).
