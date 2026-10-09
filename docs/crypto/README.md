# Cryptography

Three independent implementations must produce and read exactly the same
bytes:

| Client | Code | Primitives from |
|---|---|---|
| Web | `web/src/lib/crypto/` | WebCrypto (AES-GCM), `hash-wasm` (Argon2id) |
| Mobile | `app/lib/core/crypto/` | `pointycastle` |
| Migration CLI | `migration-cli/src/encryptor.ts` | Node `crypto` (AES-GCM), `hash-wasm` (Argon2id) |

The server performs no media cryptography at all.

## Key hierarchy

```
passphrase ──Argon2id(salt = vault.kekSalt)──► KEK   one per vault, memory only
                                                │
                                                ├─ encrypts ─► vault verification token
                                                ├─ encrypts ─► vault label, album names, per-item metadata
                                                └─ wraps ────► DEK   one random key per media item
                                                                │
                                                                └─ encrypts ─► thumb, preview, original
```

## Parameters

**Key derivation: Argon2id**, version 1.3 (`0x13`)

| Parameter | Value |
|---|---|
| Password | passphrase as UTF-8 |
| Salt | the vault's `kekSalt`, base64-decoded |
| Iterations | 3 |
| Memory | 65536 KiB (64 MiB) |
| Parallelism | 1 |
| Output | 32 bytes |

**Encryption: AES-256-GCM**

| Parameter | Value |
|---|---|
| Key | 32 bytes |
| IV / nonce | 12 random bytes, fresh for every encryption |
| Additional data | none |
| Output | ciphertext followed by the 16-byte tag |

Binary values in API payloads and the database are base64.

## What is encrypted with what

| Data | Key | Stored in |
|---|---|---|
| Vault verification token: the vault's UUID string | KEK | `key_groups.kek_verify` |
| Vault label | KEK | `key_groups.label_encrypted` |
| Album name | KEK | `albums` |
| Per-item metadata, as JSON (filename, GPS, …) | KEK | `media_vault_access.encrypted_meta` |
| DEK (32 bytes) | KEK | `media_vault_access.encrypted_dek` |
| Thumbnail, preview, original | DEK, a separate IV each | object storage |

The verification token is how a client checks a passphrase without the server:
derive a KEK, decrypt `kek_verify`, and compare the result with the vault's
id. Because the token is the id itself, the client generates the vault id
before creating the vault.

## What stays in plaintext

So that the server can sort and paginate, these are not encrypted: media type,
capture time and year-month, dimensions, duration, file size, aspect ratio,
and which items belong to which vault and album. See
[security](../security.md) for what that reveals.

## Shared test vectors

[`crypto-vectors.json`](../../crypto-vectors.json) at the repository root holds
fixed inputs and the exact outputs expected for them: derived KEKs, raw GCM
ciphertexts, a complete vault record and a complete media record.

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
client only will produce media the others cannot open. Existing vaults are not
migrated automatically; a format change needs a plan for data already
encrypted.

## Client-side key handling

**Web.** Keys exist only inside `crypto.worker.ts`. The KEK is imported as a
non-extractable `CryptoKey` and the raw Argon2 output is zeroed afterwards.
Locking terminates the worker. IndexedDB caches ciphertext only. A JavaScript
string cannot be wiped, so the passphrase is cleared from the input and never
stored, but may linger in memory until garbage collection.

**Mobile.** Thumbnails cached on disk are re-encrypted with a cache key
derived from the KEK as `SHA-256(KEK ‖ "kura-vault-thumbnail-cache")`.

Background and rationale: [0001 system design](../design/0001-system-design.md)
sections 3 and 8, and [0004](../design/0004-react-web-client.md).
