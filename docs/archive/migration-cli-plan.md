> **Historical document.** Original migration CLI build plan, April 2026. Kept unedited for reference; it is not maintained to match the code.
> Current usage: [getting started](../getting-started.md#migration-cli). See also the [archive notes](README.md).

# Migration CLI - Bulk Upload Tool

## Overview

Node.js CLI tool for the initial 500GB migration.
Scans local folders, generates thumbnails/previews, encrypts,
and uploads to S3 with resume support.

## Setup

```bash
cd migration-cli
pnpm init
pnpm add @aws-sdk/client-s3 @aws-sdk/lib-storage sharp fluent-ffmpeg
pnpm add better-sqlite3 glob commander ora chalk
pnpm add -D typescript @types/node @types/better-sqlite3 ts-node
```

## package.json

```json
{
  "name": "kura-vault-migration",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "migrate": "ts-node src/index.ts",
    "migrate:resume": "ts-node src/index.ts --resume"
  }
}
```

## Usage

```bash
# First run - specify source folder, vault passphrase, and vault ID
pnpm migrate \
  --source ~/Photos \
  --vault-id "uuid-of-family-vault" \
  --passphrase "family-memories-2024" \
  --api-url http://localhost:3000/api/v1 \
  --device-id "device-001" \
  --password "device-password" \
  --concurrency 5

# Resume after interruption
pnpm migrate:resume \
  --source ~/Photos \
  --vault-id "uuid-of-family-vault" \
  --passphrase "family-memories-2024" \
  --api-url http://localhost:3000/api/v1 \
  --device-id "device-001" \
  --password "device-password"
```

## Architecture

```
src/
├── index.ts          # CLI entry point (commander)
├── scanner.ts        # Scan folders, read EXIF, build manifest
├── processor.ts      # Generate thumbnails + previews (Sharp/ffmpeg)
├── encryptor.ts      # AES-256-GCM encryption (Node.js native crypto)
├── uploader.ts       # S3 multipart upload with concurrency
├── api-client.ts     # Call backend API (login, upload/init, upload/complete)
├── progress.ts       # SQLite progress tracker for resume
└── types.ts          # Shared types
```

## Key Implementation Details

### scanner.ts
- Use `glob` to find all image/video files recursively
- Supported: jpg, jpeg, png, heic, heif, webp, gif, mp4, mov, avi, mkv
- Read EXIF with `sharp.metadata()` for images
- Read metadata with `fluent-ffmpeg.ffprobe()` for videos
- Extract: captured_at, width, height, duration, GPS (encrypted later)

### processor.ts
- **Images**: Use Sharp to generate:
  - Thumbnail: 200px shortest edge, JPEG quality 80
  - Preview: 1080px shortest edge, JPEG quality 85
- **Videos**: Use ffmpeg to generate:
  - Thumbnail: extract frame at 1 second, resize to 200px
  - Preview: extract frame at 1 second, resize to 1080px
  - (Video file itself is the "original")

### encryptor.ts
```typescript
import { createCipheriv, randomBytes } from 'crypto';

function encryptBlob(plaintext: Buffer, dek: Buffer): { encrypted: Buffer; iv: Buffer } {
  const iv = randomBytes(12); // GCM nonce
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, authTag]), // append auth tag
    iv,
  };
}

function wrapDek(dek: Buffer, kek: Buffer): { encryptedDek: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedDek: Buffer.concat([encrypted, authTag]),
    nonce,
  };
}
```

### progress.ts
- SQLite database tracking each file's status
- Schema: `files(path TEXT PK, media_id TEXT, status TEXT, error TEXT, updated_at TEXT)`
- Status: 'pending' → 'processing' → 'uploading' → 'completing' → 'done' | 'failed'
- On resume: skip files with status 'done'

### Pipeline per file:
```
1. Check progress DB → skip if 'done'
2. Read file → extract EXIF metadata
3. Generate thumbnail + preview (Sharp/ffmpeg)
4. Generate random DEK (32 bytes)
5. Encrypt: thumb, preview, original → each with DEK + unique IV
6. Wrap DEK with KEK (derived from passphrase)
7. Call API: POST /media/upload/init → get pre-signed S3 URLs + mediaId
8. Upload encrypted thumb, preview, original to S3 (parallel)
9. Call API: POST /media/upload/complete → store metadata + encrypted DEK
10. Update progress DB → 'done'
```

## Time Estimate

With 5 concurrent uploads at 10 Mbps:
- Thumbnails (~5GB): ~1 hour
- Previews (~50GB): ~11 hours
- Originals (~500GB): ~4-5 days

Strategy: Upload thumbs+previews first (gallery browsable within hours),
then originals in background.
