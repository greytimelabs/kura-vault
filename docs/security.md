# Security model

To report a vulnerability, see [SECURITY.md](../SECURITY.md). This page
describes what the design protects, the rules the code is expected to follow,
and where the protection stops. The project has not had an independent audit.

## The core guarantee

Media, file names, location data, album names and vault names are encrypted on
the client. Every key is either random or derived from a passphrase that never
leaves the device, and is stored only wrapped: under a passphrase, under
another key, or sealed to a user's public key. The API, the database and the
storage bucket hold only ciphertext and wrapped keys. Someone with full access
to all three still cannot view anything without a user's master passphrase.

How this is done is described in [crypto](crypto/README.md).

## Three secrets

| Secret | What it opens | Who sees it |
|---|---|---|
| Password | The API: a session on the server | The server, once per sign-in, to check a bcrypt hash |
| Master passphrase | The account's private keys | Nobody. It is checked on the device |
| Vault passphrase | A vault you created (on top of the master passphrase) | Nobody |

The clients refuse a master passphrase equal to the password, because the
server sees passwords.

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Storage provider or bucket compromise | Blobs are AES-256-GCM ciphertext; keys are never in the bucket |
| Database or API server compromise | Only wrapped keys, salts, public keys and structural metadata are stored |
| Server substitutes a public key to receive a shared key | Keys are sealed only to users whose keys the owner certified; a new user's keys are bound to their invite link, which the server never sees |
| Server plants a key it knows on a user | A shared key is used only if its sender, certified, signed it |
| Server moves a wrapped key or blob to another row | Every ciphertext authenticates the ids it belongs to |
| Someone finds the API | No sign-up: accounts come from the owner's invite links. bcrypt passwords, lockout, rate limiting |
| Someone finds a new server before its owner does | Creating the owner needs the setup key from the server's log or environment |
| Stolen access token | 15-minute lifetime; grants ciphertext and short-lived URLs, not keys |
| Stolen refresh token | Stored hashed, rotated on every use, revoked on logout; httpOnly cookie in browsers |
| Leaked storage URL | Pre-signed, 60 seconds for downloads, 15 minutes for uploads; yields ciphertext only |
| Passphrase guessing | Argon2id with 64 MiB memory cost per guess |
| Someone learns a vault passphrase | Opens nothing without that account's private keys as well |
| Someone looks at your unlocked app | Vaults you created are never listed; only the ones matching an entered passphrase open |
| Lost or borrowed device | Keys are held in memory only and destroyed on lock, after 15 minutes idle, and when the app or tab closes |
| A user should no longer have access | Unsharing or restricting deletes their wrapped keys and is enforced on their next request |

## What is not hidden

The server needs some information to sort, paginate and authorise, and that
information is visible to anyone who compromises it:

- Usernames, each account's role and access level, and public keys.
- How many vaults, albums and items exist, which items are in which, who
  created each vault, and who it and its albums are shared with.
- Per item: photo or video, capture time, dimensions, duration, file size, and
  who uploaded it.
- Access patterns: when an account signs in and what it fetches.

Other limits to be aware of:

- **No passphrase recovery.** A forgotten master passphrase makes everything
  only that account could open permanently unreadable; a forgotten vault
  passphrase does the same for that vault unless it was shared. The owner
  cannot reset either. This is by design.
- **Revocation is a server cut-off, not re-encryption.** Unsharing or
  restricting deletes the user's wrapped keys and refuses their requests at
  once. It does not change the vault or album key. Someone who kept a key and
  later obtains ciphertext (a server or bucket breach) could still decrypt it,
  including items added afterwards. Key rotation is not built yet.
- **Download links already issued stay valid for up to 60 seconds** after
  access is removed.
- **Read versus write is enforced by the server only.** Anyone holding a key
  can encrypt under it; what stops a view-only user from uploading is the API.
- **Whoever opens an invite link first becomes that user.** Send links over a
  channel you trust. They work once, for 24 hours; the owner sees the join and
  can restrict the account.
- **The owner is trusted to say who the users are**, not to read anything.
  The owner account cannot open a vault that was not shared with it, but a
  malicious owner could certify a key of their own under someone's name.
- **Vault existence is not deniable to the server.** Hidden vaults are hidden
  from people looking at your screen, not from the operator.
- **Shared passphrases show a picker.** If one passphrase opens several of
  your vaults, the client lists them, which tells an observer that more than
  one exists.
- **A compromised client device is out of scope.** Malware on an unlocked
  device can read what the user can.
- **Browser delivery.** The web client is JavaScript served by the host. A
  compromised web host could serve a modified client. Self-host it from
  infrastructure you control.

### Hosted clients

The mobile apps and the multi-server web build connect to a server the user
types. For the mobile apps this changes nothing above: tokens are in the
platform keystore, per account, and the password is never stored.

A web client hosted apart from the server is weaker than the same-origin
build in three ways, and anyone relying on one should know them:

- **Refresh tokens are readable by page script.** A cookie cannot cross
  sites, so each account's refresh token is kept in `localStorage`. A script
  injection bug could steal a session. A stolen session reaches encrypted
  blobs and structural metadata; it does not reveal a passphrase or decrypt
  anything.
- **The host is trusted by every server's users.** It serves the code that
  handles their passphrases.
- **The policy is wider.** `connect-src` allows any `https:` origin, so it no
  longer limits where injected script could send data.

Plain `http://` is refused by both clients except for local addresses
(localhost and private IP ranges in the app, localhost only on the web),
where the app warns before continuing.

## Rules for the codebase

Changes are expected to keep all of these true.

**Secrets and credentials**

1. Account passwords are stored only as bcrypt hashes (12 rounds by default).
2. Refresh tokens and invite tokens are stored only as SHA-256 hashes. An
   invite link's secret never reaches the server at all.
3. Passwords, tokens, keys and passphrases are never logged. The one
   exception is the generated setup key, printed once at start while the
   server has no owner; it stops working when the owner is created.
4. Credentials are never committed; only `.env.example` files with
   placeholders are tracked.

**Authentication**

5. Five failed logins lock an account for 15 minutes.
6. Login does the same bcrypt work for unknown usernames, so response time
   does not reveal which ids exist.
7. Refresh tokens rotate on every use; a used or revoked token is rejected.
8. The access token's account is checked as active on every request, so a
   restricted account is refused at once, not when its token expires.
8a. There is no public sign-up. An account is created by the setup key (the
   owner, once) or by a single-use invite the owner issued.

**API**

9. Every media, album and vault route asks `AccessService` what the caller
   may do there. Access comes only from `vault_members` and `album_members`
   rows; the owner role grants none.
9a. A vault and its albums are shared only by the vault's creator, and only
   with an active account whose keys are certified.
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

21. The server never receives plaintext media, a master or vault passphrase,
    or any unwrapped key.
22. Every encryption uses a fresh random 12-byte IV and authenticates the ids
    it belongs to as additional data.
23. The three clients stay byte-compatible, enforced by the shared
    [test vectors](crypto/README.md#shared-test-vectors).
24. No key is stored unwrapped: file keys under a vault or album key, album
    keys under the vault key, vault and album keys sealed per user, private
    keys under the master passphrase.
25. A client seals a key only to a user whose certificate verifies against
    the owner key it trusts, and uses a shared key only if its certified
    sender signed it.
26. Random bytes come from the platform's CSPRNG, never from a seeded
    generator.

These started as the rule list in the
[original build instructions](archive/build-instructions.md). The original
threat model is in [0001 system design](design/0001-system-design.md),
sections 2 and 13; accounts and sharing are in
[0005](design/0005-accounts-keys-sharing.md). The rules about access, sharing
and tampering are exercised against a real server by `pnpm test:api` in
`web/`.
