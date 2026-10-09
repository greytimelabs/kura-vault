# 0001 — System design and architecture plan

> **Historical design document.** Version 1.0, April 2026, converted from the
> original Word document. It records the design the project started from and
> is kept for its reasoning (threat model, encryption design, cost model). It
> is **not** maintained to match the code. Known differences:
>
> - The ORM is **TypeORM**, not Prisma (sections 1, 5, 14).
> - Section 5.2 lists 7 tables; the implemented schema has 9, with extra
>   columns. See [the database docs](../database/README.md).
> - Media favourite/archive flags were replaced by a per-user "Liked" album.
>   See [0003](0003-liked-album-replaces-favorites.md).
> - The web client is a separate React app, not Flutter web.
>   See [0004](0004-react-web-client.md).
> - Storage also runs against S3-compatible services such as Cloudflare R2;
>   the AWS-specific infrastructure in sections 9 and 10 is one deployment option.
>
> For the current state start at [architecture](../architecture.md).

**Kura Vault** — encrypted personal media storage and streaming system.
Stack at time of writing: Flutter + NestJS + AWS + PostgreSQL.

## 1. Executive Summary

Kura Vault is a personal encrypted media storage and streaming system designed to store ~500GB of photos and videos on AWS S3 with end-to-end client-side encryption. The system ensures that even if AWS infrastructure is fully compromised, no one can view the media without the owner's passphrase.

> **⚡ Key Design Principles**
>
> **Zero-knowledge server:** The backend never sees decrypted media or encryption keys. **Multi-vault compartmentalization:** 3–4 independent passphrases control separate groups of albums with plausible deniability. **Gallery-speed streaming:** Tiered thumbnails, parallel decryption, and encrypted local caching ensure a native phone gallery feel. **AES-256-GCM:** Quantum-resistant symmetric encryption throughout.

| Attribute | Detail |
|---|---|
| Total Media Size | ~500 GB (initial upload), ~3–4 GB/year ongoing |
| User Model | Single owner + family viewers via shared vault passphrases |
| Access Frequency | ~once a week, must be instant when accessed |
| Encryption | Client-side AES-256-GCM with envelope encryption |
| Quantum Resistance | AES-256 is resistant (Grover’s reduces to 128-bit equivalent, still infeasible) |
| Client Platform | Flutter (iOS, Android, desktop, web) |
| Backend | NestJS on AWS ECS + PostgreSQL (Prisma) + S3 |
| Estimated Monthly Cost | ~$8–15/month (S3 + RDS + ECS minimal) |

## 2. Problem Statement & Constraints

Store a large personal media library on cloud infrastructure (AWS) while guaranteeing that no entity — including AWS, attackers, or state actors with quantum computing — can view the media. The system must simultaneously provide a smooth, gallery-like browsing experience comparable to native phone gallery apps.

### 2.1 Threat Model

| Threat | Mitigation | Status |
|---|---|---|
| Random internet attacker finds API | WAF + device registration + JWT auth | ✅ Covered |
| Stolen JWT token | Device-bound tokens + short expiry + refresh rotation | ✅ Covered |
| S3 bucket discovery | Private bucket + CloudFront OAC + signed URLs (60s expiry) | ✅ Covered |
| AWS employee / infrastructure breach | Client-side encryption; AWS only stores opaque blobs | ✅ Covered |
| Quantum computing attack | AES-256-GCM (symmetric, quantum-resistant) | ✅ Covered |
| Physical device theft | App passphrase lock + encrypted cache + biometric | ✅ Covered |
| Shoulder surfing / social exposure | Multi-vault: only unlocked vault’s albums visible | ✅ Covered |

## 3. Encryption Architecture

### 3.1 Why Client-Side Encryption

AWS-managed encryption (SSE-S3, SSE-KMS) protects data at rest from physical theft of drives, but AWS itself holds the decryption keys. This means an AWS breach, subpoena, or insider threat could expose your media. Client-side encryption ensures the encryption and decryption keys never leave your device.

> **🔒 Core Principle**
>
> Encrypt BEFORE upload. Decrypt AFTER download. The server is a dumb blob store that never sees plaintext media, plaintext keys, or passphrases. All cryptographic operations happen exclusively on the client device in RAM.

### 3.2 Envelope Encryption

Envelope encryption uses a two-layer key hierarchy. Each photo is encrypted with a unique random Data Encryption Key (DEK). The DEK itself is then encrypted with a Key Encryption Key (KEK, the master key) derived from the user's passphrase. This means the master key never directly touches media bytes, and compromising a single DEK exposes only one photo.

#### Encryption Flow (Upload)

| Step | Operation | Where |
|---|---|---|
| 1 | User enters passphrase | Client (Flutter app) |
| 2 | Derive KEK = Argon2id(passphrase, vault_salt) | Client RAM only |
| 3 | Generate random DEK (32 bytes) for this photo | Client RAM only |
| 4 | Generate random IV/nonce (12 bytes) | Client RAM only |
| 5 | Encrypt photo: AES-256-GCM(photo_bytes, DEK, IV) → encrypted_blob + auth_tag | Client RAM only |
| 6 | Encrypt DEK: AES-256-GCM(DEK, KEK, new_nonce) → encrypted_dek | Client RAM only |
| 7 | Upload encrypted_blob to S3 via pre-signed URL | S3 (opaque bytes) |
| 8 | Store encrypted_dek, IVs, metadata in Postgres via API | Postgres (opaque) |
| 9 | Discard DEK from memory (goes out of scope, zeroed) | Client |

#### Decryption Flow (Viewing)

| Step | Operation | Where |
|---|---|---|
| 1 | App already has KEK in memory (derived from passphrase at unlock) | Client RAM |
| 2 | Fetch encrypted_dek + pre-signed S3 URL from API | API → Client |
| 3 | Fetch encrypted_blob from S3 via pre-signed URL | S3 → Client |
| 4 | Decrypt DEK: AES-GCM-Decrypt(encrypted_dek, KEK, nonce) → DEK | Client RAM (~1ms) |
| 5 | Decrypt photo: AES-GCM-Decrypt(encrypted_blob, DEK, IV) → photo_bytes | Client RAM (~1ms for thumb) |
| 6 | Display photo_bytes in Image widget | Client screen |
| 7 | DEK goes out of scope, zeroed and garbage collected | Client RAM |

### 3.3 Algorithm Choices

| Component | Algorithm | Why |
|---|---|---|
| Key derivation | Argon2id (t=3, m=64MB, p=1) | Memory-hard, resistant to GPU/ASIC brute force. ~1s per derivation. |
| Symmetric encryption | AES-256-GCM | Authenticated encryption (confidentiality + integrity). Quantum-resistant. |
| DEK generation | CSPRNG (32 bytes) | Cryptographically secure random; unique per photo. |
| Cache key derivation | HKDF-SHA256(KEK, context) | Deterministic sub-key from KEK for local cache encryption. |
| Passphrase verification | Encrypt known UUID with KEK | Verify passphrase correctness without storing passphrase. |

## 4. Multi-Vault System

The system supports 3–4 independent vaults (key groups), each protected by a different passphrase. Each passphrase derives a unique KEK. When the user enters a passphrase, only albums belonging to the matching vault are visible. Other vaults are completely invisible — no locked icons, no count, no indication they exist.

> **🛡️ Plausible Deniability**
>
> When you open the app in front of friends or family and enter a specific passphrase, they see only the albums in that vault. There is no UI evidence that other vaults exist. If asked, you can truthfully say "these are the photos in this account" because that is exactly what is shown.

### 4.1 Vault Example Configuration

| Vault | Passphrase (example) | Albums | Shared With |
|---|---|---|---|
| Family | family-memories-2024 | Family Trips, Birthdays, Home, Diwali (8 albums) | Parents, siblings |
| Friends | college-gang-forever | College, Road Trips, Memes (5 albums) | Close friends |
| Work | work-docs-archive | Screenshots, Docs, Events (3 albums) | Only you |
| Private | personal-vault-key | Journal, Personal (4 albums) | Strictly you |

### 4.2 Vault Unlock Flow

**Step 1:** App opens and shows passphrase screen (no indication of how many vaults exist). **Step 2:** User enters passphrase. **Step 3:** App fetches all vault salt/verification records from API. **Step 4:** For every vault — with no early exit — derive a candidate KEK from the passphrase and that vault's salt, then try to decrypt that vault's verification token. Candidate KEKs that fail verification are zeroed immediately. **Step 5:** Every vault whose verification token decrypts to its own UUID is a match. Because each vault has a distinct random salt, the same passphrase derives a different KEK per vault, so one passphrase may legitimately match more than one vault. Each match is verified independently; this is not a cryptographic collision. **Step 6:** If exactly one vault matches, it is unlocked immediately and its albums and media become visible. If more than one vault matches, the app presents a picker listing only the matched vaults, identified by their decrypted labels, and the user chooses which one to open. The KEKs of the vaults not chosen are zeroed. **Step 7:** All non-matching vaults remain completely invisible. The picker never reveals a vault that did not match, and never appears when only one vault matches. **Step 8:** Derivation runs against every vault with no early exit, so unlock latency does not reveal which vault matched.

#### 4.2.1 Shared Passphrases

Reusing one passphrase across multiple vaults is permitted and is not blocked at vault creation. The server cannot detect reuse: it stores only salts and ciphertext and never sees a passphrase or a KEK, so detection is possible only on the client, by deriving the candidate passphrase against every existing vault salt. No record of shared passphrases is ever stored server-side — such a marker would be a plaintext link between compartments visible to anyone with database access.

When a passphrase matches multiple vaults, the collision is resolved at unlock time by the picker described in Step 6 above, so no vault becomes unreachable.

Deniability caveat: the picker discloses to anyone observing an unlock that the entered passphrase opens more than one vault. It lists only the vaults that matched and never those that did not, and it never appears in the single-match case — but a passphrase intended for use under observation should not be shared across vaults.

### 4.3 Cross-Vault Photo Sharing (Many-to-Many)

A single photo can appear in albums belonging to different vaults. The encrypted blob on S3 remains a single copy — no data duplication. Instead, the DEK for that photo is wrapped (encrypted) separately with each vault's KEK. Each vault gets its own encrypted copy of the DEK stored in a junction table.

#### How Cross-Vault Assignment Works

To add an existing photo (currently in Vault A) to an album in Vault B, both vaults must be unlocked simultaneously. The app: **(1)** decrypts the photo's DEK using KEK-A, **(2)** re-encrypts the same DEK with KEK-B, **(3)** stores the new encrypted_dek in media_vault_access for Vault B. No S3 upload needed — just a new 100-byte row in Postgres.

## 5. Database Schema (PostgreSQL + Prisma)

The schema separates vault-independent structural data (on the media table) from vault-specific encrypted data (on the media_vault_access junction table). This allows server-side filtering and pagination without the server ever seeing actual media content.

### 5.1 Tables Overview

| Table | Purpose | Sensitive Data? |
|---|---|---|
| key_groups | Vault definitions: salt, verification token | No (salts are not secret) |
| users | Device registrations and roles | No |
| user_vault_access | Which users can access which vaults | No |
| albums | Album metadata, linked to a vault | Album name encrypted |
| media | Photo/video structural metadata + S3 keys | Timestamps plaintext; content encrypted |
| media_vault_access | Junction: per-vault wrapped DEKs + encrypted metadata | DEKs and metadata encrypted |
| album_media | Junction: many-to-many albums ↔ media | No |

### 5.2 Full Schema

```
-- Vaults (key groups)
CREATE TABLE key_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kek_salt    TEXT NOT NULL,
    kek_verify  TEXT NOT NULL,
    label_enc   TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Users (owner + family viewers)
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    device_id   TEXT UNIQUE NOT NULL,
    role        VARCHAR(10) NOT NULL DEFAULT 'viewer',
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- User vault access permissions
CREATE TABLE user_vault_access (
    user_id       UUID REFERENCES users(id),
    key_group_id  UUID REFERENCES key_groups(id),
    permission    VARCHAR(10) NOT NULL DEFAULT 'view',
    PRIMARY KEY (user_id, key_group_id)
);

-- Albums (belong to one vault)
CREATE TABLE albums (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_group_id    UUID REFERENCES key_groups(id),
    name_encrypted  TEXT,
    cover_media_id  UUID,
    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Media (vault-independent structural data)
CREATE TABLE media (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at       TIMESTAMPTZ,
    media_type        VARCHAR(10) NOT NULL,
    file_size_bytes   BIGINT,
    width             INT,
    height            INT,
    duration_seconds  INT,
    aspect_ratio      FLOAT,
    year_month        VARCHAR(7),
    s3_key_thumb      TEXT NOT NULL,
    s3_key_preview    TEXT NOT NULL,
    s3_key_original   TEXT NOT NULL,
    thumb_iv          TEXT NOT NULL,
    preview_iv        TEXT NOT NULL,
    original_iv       TEXT NOT NULL,
    is_favorite       BOOLEAN DEFAULT false,
    is_archived       BOOLEAN DEFAULT false,
    uploaded_at       TIMESTAMPTZ DEFAULT now(),
    created_at        TIMESTAMPTZ DEFAULT now()
);

-- Per-vault wrapped DEKs (junction)
CREATE TABLE media_vault_access (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id        UUID REFERENCES media(id),
    key_group_id    UUID REFERENCES key_groups(id),
    encrypted_dek   TEXT NOT NULL,
    dek_nonce       TEXT NOT NULL,
    encrypted_meta  TEXT,
    meta_nonce      TEXT,
    UNIQUE(media_id, key_group_id)
);

-- Album-media many-to-many
CREATE TABLE album_media (
    album_id    UUID REFERENCES albums(id),
    media_id    UUID REFERENCES media(id),
    sort_order  INT DEFAULT 0,
    added_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (album_id, media_id)
);

-- Performance indexes
CREATE INDEX idx_mva_vault ON media_vault_access(key_group_id);
CREATE INDEX idx_mva_media ON media_vault_access(media_id);
CREATE INDEX idx_album_media_album ON album_media(album_id);
CREATE INDEX idx_album_media_media ON album_media(media_id);
CREATE INDEX idx_media_captured ON media(captured_at DESC);
CREATE INDEX idx_media_yearmonth ON media(year_month);
CREATE INDEX idx_albums_vault ON albums(key_group_id);
```

## 6. API Design (NestJS)

The API is deliberately thin. It never handles media bytes — uploads and downloads happen directly between the Flutter client and S3/CloudFront via pre-signed URLs. The API manages authentication, metadata, and URL generation only.

### 6.1 Endpoints

| Method | Endpoint | Purpose | Auth |
|---|---|---|---|
| POST | /auth/device/register | Register a new device (invite code required) | Invite code |
| POST | /auth/login | Authenticate device, get JWT + refresh token | Device ID |
| POST | /auth/refresh | Rotate refresh token, get new JWT | Refresh token |
| GET | /vaults | List vault IDs + salts + verification tokens | JWT |
| POST | /vaults | Create a new vault | JWT + owner |
| POST | /vaults/:id/invite | Generate a one-time invite code for family | JWT + admin |
| GET | /media?vault=X&page=1&limit=50 | List media metadata + encrypted DEKs for vault | JWT + vault access |
| GET | /media/:id/urls | Get pre-signed CloudFront URLs (thumb/preview/original) | JWT + vault access |
| POST | /media/upload/init | Get pre-signed S3 upload URLs for 3 tiers | JWT + admin |
| POST | /media/upload/complete | Confirm upload, store encrypted DEK + metadata | JWT + admin |
| POST | /media/:id/vault-access | Add cross-vault DEK wrapping | JWT + admin |
| DELETE | /media/:id/vault-access/:vaultId | Remove photo from a vault | JWT + admin |
| GET | /albums?vault=X | List albums for a vault | JWT + vault access |
| POST | /albums | Create album in a vault | JWT + admin |
| PUT | /albums/:id | Update album metadata | JWT + admin |
| POST | /albums/:id/media | Add photo to album (album_media junction) | JWT + admin |
| DELETE | /albums/:id/media/:mediaId | Remove photo from album | JWT + admin |

### 6.2 Pre-Signed URL Strategy

**Uploads:** The API generates pre-signed S3 PUT URLs valid for 15 minutes. The client uploads encrypted blobs directly to S3 without the API server touching any bytes. **Downloads:** The API generates pre-signed CloudFront GET URLs valid for 60 seconds. CloudFront serves encrypted blobs from S3 via Origin Access Control (OAC). The client fetches and decrypts locally. Even if a URL is intercepted, the blob is encrypted and the URL expires quickly.

> **⚙️ API Infrastructure Note**
>
> The API server (NestJS on ECS) handles only JSON metadata and URL generation. It does not proxy media bytes. A t3.micro or t4g.micro instance is sufficient. All heavy data transfer is between the client and S3/CloudFront directly.

## 7. Flutter Client Architecture

### 7.1 Layer Overview

| Layer | Components | Key Packages |
|---|---|---|
| UI Layer | Timeline View, Album Grid, Photo Viewer, Settings/Auth | flutter, cached_memory_image (custom) |
| State Management | VaultProvider, AlbumProvider, MediaProvider, CryptoProvider | Riverpod or Bloc |
| Service Layer | CryptoService, ApiClient, CacheService, UploadService | Dio, pointycastle / flutter_sodium |
| Cache Layer | Encrypted thumbnail cache, LRU eviction at 500MB | Isar or Hive (encrypted mode) |
| Platform Layer | Biometric auth, Keychain/Keystore, gallery access | flutter_secure_storage, local_auth |

### 7.2 Custom ImageProvider

Flutter's built-in CachedNetworkImage cannot be used because thumbnails must be decrypted before display. A custom ImageProvider handles the pipeline: check local encrypted cache → if miss, fetch encrypted blob from CloudFront → decrypt with DEK → cache decrypted bytes (re-encrypted with cache key) → return MemoryImage to the widget.

### 7.3 Parallel Decryption with Dart Isolates

When loading an album page (50 thumbnails), decryption is parallelized across 4 Dart isolates. Each isolate receives a batch of encrypted blobs + encrypted DEKs + the KEK, performs independent decryptions, and returns plaintext image bytes. On modern phones with hardware AES instructions, decrypting a 15KB thumbnail takes under 1ms. The entire page of 50 thumbnails completes in ~15–20ms of compute time. The actual bottleneck is the network fetch, not decryption.

### 7.4 Key Flutter Packages

| Package | Purpose | Notes |
|---|---|---|
| pointycastle | AES-256-GCM, Argon2id (pure Dart) | Works everywhere; slower than native |
| cryptography_flutter / flutter_sodium | Native AES via FFI | 10–100x faster; hardware-accelerated on ARM |
| Dio | HTTP client for API + S3 pre-signed URLs | Interceptors for JWT refresh |
| Isar / Hive | Encrypted local cache for thumbnails | Isar preferred for query performance |
| flutter_secure_storage | Store Argon2 salt, device token, biometric-wrapped KEK | Backed by Keychain (iOS) / Keystore (Android) |
| local_auth | Biometric unlock (fingerprint, face) | Optional convenience layer over passphrase |
| photo_manager | Access device gallery for uploads | Read-only access to pick photos |

## 8. Client-Side Encryption Lifecycle

> **⚠️ The Golden Rule**
>
> Nothing decrypted EVER touches disk in plaintext. All sensitive material (passphrase, KEK, DEKs, decrypted photo bytes) exists exclusively in RAM and only for the minimum time needed.

### 8.1 Secret Lifecycle Summary

| Secret | Stored on Disk? | Where It Lives | Lifetime |
|---|---|---|---|
| Passphrase | **NEVER** | Text input field RAM | Milliseconds (cleared after derivation) |
| KEK (master key) | **NEVER** in plaintext. Optionally biometric-encrypted. | RAM variable | While app is unlocked |
| DEK (per-photo key) | **NEVER** | Local variable in decrypt function | ~2–5 milliseconds during decrypt |
| Decrypted photo bytes | **NEVER** | Image widget memory | While displayed on screen |
| Cached thumbnails | **YES** but encrypted with cache key derived from KEK | Isar/Hive DB on disk | Until LRU eviction or manual clear |
| Argon2 salt | **YES** (not secret) | flutter_secure_storage + server | Permanent |
| Device token | **YES** (secure storage) | flutter_secure_storage | Until logout |

### 8.2 App Unlock Flow

```
App launches (cold start)
  │
  └── RAM: empty, Disk: salt + device token only
  │
Passphrase screen appears
  │
User types passphrase: "family-memories-2024"
  │
KEK = Argon2id(passphrase, vault_salt, t=3, m=64MB, p=1)
  │    (~1 second, runs in Dart isolate to avoid UI freeze)
  │
  ├── RAM: KEK now in _kek variable
  ├── Passphrase string: out of scope, GC eligible
  │
Verify: decrypt kek_verify with KEK
  │
  ├── Repeat for EVERY vault (no early exit)
  │
  ├── 0 matches  → Wrong passphrase, wipe KEKs, ask again
  ├── 1 match    → Unlock it, load albums
  └── 2+ matches → Same passphrase on multiple vaults:
                   show picker of MATCHED vaults only,
                   unlock the chosen one, zero the rest
```

### 8.3 Gallery Viewing Flow

```
User opens Timeline view
  │
API: GET /media?vault=family&page=1&limit=50
  │
  └── Returns: 50x { id, captured_at, encrypted_dek,
  │         dek_nonce, thumb_iv, thumb_presigned_url }
  │
For each of 50 items (parallelized across 4 Dart isolates):
  │
  ├── Check Isar cache for media_id
  │     ├── HIT: decrypt from cache with cache_key → display
  │     └── MISS: continue
  │
  ├── HTTP GET thumb_presigned_url → encrypted_thumb_bytes
  │
  ├── DEK = AES-GCM-Decrypt(encrypted_dek, KEK, dek_nonce)
  │     (DEK exists for ~1ms in local variable)
  │
  ├── photo = AES-GCM-Decrypt(encrypted_thumb, DEK, thumb_iv)
  │     (DEK goes out of scope here)
  │
  ├── Cache: encrypt photo with cache_key → store in Isar
  │
  └── Return MemoryImage(photo) to grid widget
```

### 8.4 App Lock Flow

```
User taps Lock  OR  app idle > 5 minutes
  │
_kek.fillRange(0, length, 0)   // zero out bytes actively
_kek = null
_cacheKey.fillRange(0, length, 0)
_cacheKey = null
  │
All decrypted image references dropped
Dart GC reclaims memory
  │
  ├── RAM: clean, no secrets
  ├── Disk cache: still has entries, but encrypted
  │         (useless without KEK → without passphrase)
  │
Next unlock: passphrase → Argon2id → KEK → derive cache_key
             → cache entries decryptable again
```

### 8.5 Biometric Unlock (Optional Convenience)

**Setup:** After first passphrase entry, the app generates a biometric-bound key via the OS Keystore (Android) or Keychain (iOS). The KEK is encrypted with this biometric key and stored in flutter_secure_storage. **Usage:** On subsequent app opens, the user authenticates with fingerprint/face. The OS unlocks the biometric key, the app decrypts the KEK from storage, and the vault unlocks without typing a passphrase. **Fallback:** If biometric fails 3 times, the app falls back to passphrase entry. On device factory reset, the biometric key is destroyed and the passphrase is required again.

## 9. Storage Strategy & Cost Estimate

### 9.1 Tiered Storage Per Photo

Each photo is stored as three separately encrypted versions: a tiny thumbnail for gallery grid views, a preview for single-photo viewing, and the original full-resolution. This avoids decrypting and transferring multi-megabyte originals just to show a grid thumbnail.

| Tier | Resolution | Size | S3 Class | Use Case |
|---|---|---|---|---|
| Thumbnail | 200px short edge | 10–20 KB | S3 Standard | Gallery grid, album covers |
| Preview | 1080px short edge | 150–300 KB | S3 Standard | Single photo view, swipe |
| Original | Full resolution | 2–8 MB | S3 Glacier Instant Retrieval | Download, print, share |

### 9.2 S3 Path Structure

```
s3://kura-vault-{account}/
  ├── {vault_id}/
  │   ├── {media_id}/
  │   │   ├── thumb.enc       (10-20 KB)
  │   │   ├── preview.enc     (150-300 KB)
  │   │   └── original.enc    (2-8 MB)
  │   ├── {media_id}/
  │   │   └── ...
  └── {vault_id}/
      └── ...
```

> **💡 Cross-Vault Photos**
>
> When a photo belongs to multiple vaults, only one copy of the encrypted blob exists on S3 (under the vault that first uploaded it). The media_vault_access table handles key wrapping for other vaults. No blob duplication.

### 9.3 Monthly Cost Estimate (~500GB)

| Component | Size / Usage | S3 Class | Monthly Cost |
|---|---|---|---|
| Thumbnails | ~5 GB | Standard ($0.023/GB) | ~$0.12 |
| Previews | ~50 GB | Standard ($0.023/GB) | ~$1.15 |
| Originals | ~500 GB | Glacier Instant ($0.004/GB) | ~$2.00 |
| CloudFront | ~5 GB transfer/month | Standard | ~$0.50 |
| RDS (t4g.micro) | PostgreSQL | On-demand | ~$6.50 |
| ECS (t4g.micro) | NestJS API | Fargate spot or EC2 | ~$3–5 |
|  |  | **TOTAL** | **~$13–15/month** |

## 10. Network & Infrastructure

### 10.1 VPC Architecture

```
AWS VPC
├── Private Subnet
│   ├── ECS (NestJS API) ──────► RDS PostgreSQL (private)
│   └── VPC Endpoint ────────► S3 (gateway, no internet)
│
├── Public Subnet
│   └── ALB + WAF (only public entry point for API)
│
└── CloudFront (OAC to S3, signed URLs for clients)
```

### 10.2 Security Layers

| Layer | Protection | Implementation |
|---|---|---|
| S3 Bucket | Zero public access | CloudFront OAC only; VPC endpoint for ECS |
| RDS | Private subnet only | No public access; security group allows ECS only |
| API (ALB) | WAF + rate limiting | 100 req/min/IP, geo-restrict to India |
| Authentication | Device-bound JWTs | 15 min JWT + 7-day rotating refresh token |
| Device Registration | Invite-only | Max 8–10 devices; owner-controlled |
| CloudFront URLs | Short-lived signed URLs | 60-second expiry; content is encrypted regardless |
| Transport | HTTPS everywhere | TLS 1.3 for API; CloudFront HTTPS |

## 11. Bulk Migration Plan (500GB Initial Upload)

The initial upload is a one-time operation run from a desktop/laptop using a Node.js CLI tool. The tool processes the local photo library, generates thumbnails and previews, encrypts everything, and uploads to S3 with resume support.

### 11.1 CLI Pipeline

| Step | Operation | Tool |
|---|---|---|
| 1 | Scan folder recursively, build file manifest | Node.js fs + glob |
| 2 | Read EXIF data (date, GPS, camera, dimensions) | sharp / exiftool |
| 3 | Generate thumbnail (200px) and preview (1080px) | Sharp (images) / ffmpeg (videos) |
| 4 | Encrypt all 3 tiers with per-photo DEK (AES-256-GCM) | Node.js crypto (native) |
| 5 | Encrypt DEK with vault KEK | Node.js crypto |
| 6 | Upload encrypted blobs to S3 via multipart upload (5 concurrent) | AWS SDK v3 |
| 7 | Store encrypted DEK + metadata via API | HTTP (Axios) |
| 8 | Track progress in local SQLite (resume support) | better-sqlite3 |

### 11.2 Time Estimates

| Upload Speed | 500GB Duration | Notes |
|---|---|---|
| 10 Mbps | ~4–5 days | Typical Indian broadband |
| 50 Mbps | ~1 day | Fiber connection |
| 100 Mbps | ~12 hours | High-speed fiber |

The CLI processes thumbnails and previews first (~55GB) so the gallery is browsable within the first few hours while originals upload in the background. Resumability via local SQLite ensures no wasted upload on interruption.

## 12. Family Sharing Model

Family members can view (not modify) photos in vaults they are given access to. Sharing works through two independent mechanisms: the API invite code handles device registration and authorization, while the passphrase (shared verbally) handles encryption access.

### 12.1 Invite Flow

| Step | Action | Who |
|---|---|---|
| 1 | Owner opens Settings → Vault “Family” → Share | You |
| 2 | App generates a one-time invite code (expires 24h) | App |
| 3 | You send the invite code to family member via WhatsApp/SMS | You |
| 4 | Family member installs app → “Join with invite code” | Family member |
| 5 | API registers their device with 'viewer' role for that vault | API |
| 6 | You tell them the vault passphrase in person (verbal/face-to-face) | You |
| 7 | They enter passphrase → app derives same KEK → same vault unlocks | Family member |

> **🔑 Why This Is Secure**
>
> **Invite code alone:** grants API access (can call endpoints) but no decryption ability. **Passphrase alone:** grants decryption ability but no API access (device not registered). **Both together:** grants full viewing access. API enforces read-only for viewer role — family members cannot upload, delete, or modify.

### 12.2 Permission Model

| Action | Owner | Viewer (Family) |
|---|---|---|
| View photos in shared vault | ✅ | ✅ |
| Download originals from shared vault | ✅ | ✅ |
| Upload new photos | ✅ | ❌ |
| Delete photos | ✅ | ❌ |
| Create/edit albums | ✅ | ❌ |
| Create new vaults | ✅ | ❌ |
| Invite new family members | ✅ | ❌ |
| See other vaults | ❌ (plausible deniability) | ❌ |

## 13. Security Summary

| Security Property | How It's Achieved |
|---|---|
| Confidentiality | AES-256-GCM client-side encryption; server never sees plaintext |
| Integrity | GCM auth tags detect any tampering with encrypted blobs |
| Quantum resistance | AES-256 symmetric encryption (Grover's reduces to 128-bit, still infeasible) |
| Zero-knowledge server | API handles metadata and URLs only; never touches media bytes or keys |
| Key isolation | Per-photo DEK; per-vault KEK; compromise of one doesn't affect others |
| Plausible deniability | Multi-vault with no cross-vault visibility; unlocked vault appears to be "all photos" |
| At-rest device security | Local cache encrypted with KEK-derived cache key; flutter_secure_storage for tokens |
| In-transit security | HTTPS/TLS 1.3 for all API calls; CloudFront signed URLs (60s expiry) |
| Physical device theft | Passphrase-locked app; KEK wiped on lock; biometric with fallback |
| Brute force resistance | Argon2id with 64MB memory requirement; ~1 second per attempt |
| Infrastructure breach | S3 fully private (CloudFront OAC); RDS private subnet; WAF on ALB |
| Passphrase loss | Unrecoverable by design (this IS the security guarantee) |

> **⚠️ Critical Risk: Passphrase Loss**
>
> If you forget a vault passphrase, the data in that vault is permanently unrecoverable. This is not a bug — it's the fundamental security guarantee. Consider storing passphrase hints or backup passphrases in a physical safe or with a trusted party. The system cannot have a "forgot password" flow without compromising the zero-knowledge property.

## 14. Build Phases & Milestones

| Phase | Deliverable | Duration | Dependencies |
|---|---|---|---|
| **Phase 1** | Dart Crypto Library | 1–2 weeks | None |
|  | Argon2id key derivation, AES-256-GCM encrypt/decrypt, envelope encryption, HKDF cache key derivation. Standalone Dart package, thoroughly unit tested. |  |  |
| **Phase 2** | NestJS API + Prisma Schema | 2–3 weeks | Phase 1 (for testing) |
|  | Auth system (device registration, JWT, refresh), vault management, media CRUD, pre-signed URL generation, album management. Deployed on ECS with RDS. |  |  |
| **Phase 3** | Node.js Bulk Migration CLI | 1–2 weeks | Phase 2 |
|  | Scan folders, EXIF extraction, thumbnail/preview generation (Sharp + ffmpeg), encrypt, multipart S3 upload, resume support via SQLite. |  |  |
| **Phase 4** | Flutter App (Core Gallery) | 3–4 weeks | Phase 1 + Phase 2 |
|  | Passphrase unlock, vault selection, timeline view with virtual scroll, album grid, photo viewer with pinch zoom, encrypted local cache, parallel isolate decryption. |  |  |
| **Phase 5** | Family Sharing + Polish | 1–2 weeks | Phase 4 |
|  | Invite flow, viewer role, biometric unlock, cross-vault photo assignment, upload from device gallery, settings UI. |  |  |
| **Phase 6** | Infrastructure Hardening | 1 week | Phase 2 |
|  | CloudFront OAC, WAF rules, VPC endpoints, S3 lifecycle policies (Glacier tiering), CloudTrail audit logging. |  |  |

#### Total Estimated Timeline: 9–14 weeks
