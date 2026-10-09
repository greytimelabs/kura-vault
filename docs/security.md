# Security model

To report a vulnerability, see [SECURITY.md](../SECURITY.md). This page
describes what the design protects, the rules the code is expected to follow,
and where the protection stops. The project has not had an independent audit.

## The core guarantee

Media, file names, location data, album names and vault names are encrypted on
the client with keys derived from a passphrase that never leaves the device.
The API, the database and the storage bucket hold only ciphertext and wrapped
keys. Someone with full access to all three still cannot view anything
without a vault passphrase.

How this is done is described in [crypto](crypto/README.md).

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Storage provider or bucket compromise | Blobs are AES-256-GCM ciphertext; keys are never in the bucket |
| Database or API server compromise | Only wrapped keys, salts and structural metadata are stored |
| Someone finds the API | Device registration by invite only, bcrypt passwords, lockout, rate limiting |
| Stolen access token | 15-minute lifetime; grants ciphertext and short-lived URLs, not keys |
| Stolen refresh token | Stored hashed, rotated on every use, revoked on logout; httpOnly cookie in browsers |
| Leaked storage URL | Pre-signed, 60 seconds for downloads, 15 minutes for uploads; yields ciphertext only |
| Passphrase guessing | Argon2id with 64 MiB memory cost per guess |
| Someone looks at your unlocked app | Only the vaults matching the entered passphrase are shown |
| Lost or borrowed device | Keys are held in memory only and destroyed on lock; the web client locks on idle |

## What is not hidden

The server needs some information to sort, paginate and authorise, and that
information is visible to anyone who compromises it:

- How many vaults, albums and items exist, and which items are in which.
- Per item: photo or video, capture time, dimensions, duration, file size.
- Which devices are registered and which vaults each can reach.
- Access patterns: when a device signs in and what it fetches.

Other limits to be aware of:

- **No passphrase recovery.** A forgotten passphrase makes that vault's
  contents permanently unreadable. This is by design.
- **Vault existence is not deniable to the server**, or to another device with
  access to the same account data. The compartmentalisation is against people
  looking at your screen, not against the operator.
- **Shared passphrases show a picker.** If one passphrase opens several
  vaults, the client lists them, which tells an observer that more than one
  exists.
- **A viewer who knows a passphrase can decrypt everything in that vault.**
  The owner/viewer split controls who may write, not who may read.
- **Removing a device does not re-key a vault.** A removed viewer who kept the
  passphrase and previously downloaded ciphertext can still decrypt it.
- **A compromised client device is out of scope.** Malware on an unlocked
  device can read what the user can.
- **Browser delivery.** The web client is JavaScript served by the host. A
  compromised web host could serve a modified client. Self-host it from
  infrastructure you control.

## Rules for the codebase

Changes are expected to keep all of these true.

**Secrets and credentials**

1. Device passwords are stored only as bcrypt hashes (12 rounds by default).
2. Refresh tokens and invite codes are stored only as SHA-256 hashes.
3. Passwords, tokens, keys and passphrases are never logged.
4. Credentials are never committed; only `.env.example` files with
   placeholders are tracked.

**Authentication**

5. Five failed logins lock a device for 15 minutes.
6. Login does the same bcrypt work for unknown device ids, so response time
   does not reveal which ids exist.
7. Refresh tokens rotate on every use; a used or revoked token is rejected.
8. The access token's device is checked as active on every request.

**API**

9. Every media and album route checks that the caller has access to the vault
   it names.
10. Input is validated with unknown fields rejected
    (`whitelist` and `forbidNonWhitelisted`).
11. All ids are UUIDs; nothing is sequential.
12. Queries go through TypeORM with parameters; no string-built SQL.
13. Server errors return a generic message; stack traces are never sent.
14. CORS allows only the configured origins.
15. Requests are rate limited (100 per minute by default).
16. Helmet sets security headers on every response.
17. Pre-signed URLs are short-lived: 60 seconds to download, 15 minutes to
    upload.

**Data and deployment**

18. TypeORM `synchronize` is always off; schema changes are migrations.
19. Containers run as a non-root user (UID 1001) with `no-new-privileges`;
    PostgreSQL runs with a read-only root filesystem.
20. The web client ships a strict Content-Security-Policy and should have its
    storage origin narrowed to the real bucket in production
    (see [getting started](getting-started.md#production-build)).

**Cryptography**

21. The server never receives plaintext media, passphrases, KEKs or DEKs.
22. Every encryption uses a fresh random 12-byte IV.
23. The three clients stay byte-compatible, enforced by the shared
    [test vectors](crypto/README.md#shared-test-vectors).

These started as the rule list in the
[original build instructions](archive/build-instructions.md). The original
threat model is in [0001 system design](design/0001-system-design.md),
sections 2 and 13.
