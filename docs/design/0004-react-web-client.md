# 0004 — React web client (replaces Flutter web)

> **Decision record, October 2026.** Written before the work was done; line references are to the code as it was then.
> Current state: [architecture](../architecture.md), [crypto](../crypto/README.md).

## Context

Flutter currently serves every platform. Flutter web is the weakest target (slow load, non-native UX, Argon2 in compiled Dart is very slow, raw keys sit in the JS heap). Decision: keep Flutter for iOS/Android, rebuild web in React, optimised for desktop on Chrome, Safari and Firefox.

Reading the code showed the existing system is not end-to-end functional, so "inherit what is implemented" needs four fixes alongside the web build:

- **Viewer is a stub** — `app/lib/features/viewer/presentation/screens/photo_viewer_screen.dart:65-69` never decrypts.
- **CLI/app key mismatch** — `migration-cli/src/encryptor.ts:44` uses scrypt with a salt made from the vault ID (`index.ts:56`); the app uses Argon2id with the vault's stored salt (`core/crypto/key_derivation.dart`).
- **`POST /vaults` cannot make a valid vault** — verify token must encrypt the vault ID, but the server generates the ID (`vault.service.ts:51`).
- **One session per account** — login revokes the account's other refresh token (`auth.service.ts:193-197`).

Confirmed decisions: no real data exists (standardise on Argon2id, fix the CLI); scope is app parity **plus owner tools**; backend changes allowed = httpOnly cookie refresh, multiple sessions, vault/URL bug fixes; **no MinIO / compose changes**; videos = poster + decrypted download.

## Stack (new folder `web/`)

React 19 + TypeScript + Vite (static SPA, pnpm) · React Router · TanStack Query + TanStack Virtual · Zustand · Tailwind v4 + Radix primitives + lucide icons · `hash-wasm` (Argon2id) + WebCrypto (AES-GCM) in a dedicated Worker · `exifr` · `react-zoom-pan-pinch` · Vitest + Playwright (chromium, firefox, webkit). System fonts only; **zero third-party network requests**.

## Step 0 — crypto interop gate (do first, stop if it fails)

Wire format to match exactly (from `crypto_service.dart`, `vault_crypto_cubit.dart`):

- KEK = Argon2id(passphrase UTF-8, salt = base64-decoded `kekSalt`, t=3, m=65536 KiB, p=1, 32 bytes, v1.3)
- AES-256-GCM, 12-byte IV, no AAD, output = ciphertext ‖ 16-byte tag (identical to WebCrypto's layout)
- `kekVerify` = GCM(vault UUID string, KEK); labels, album names, `encryptedMeta` (JSON) = GCM(…, KEK); media tiers = GCM(bytes, DEK); DEK wrapped = GCM(DEK, KEK)

Gate: `web/scripts/gen-vectors.ts` writes `crypto-vectors.json` (KEKs, verify tokens, ciphertexts for fixed inputs). A new Dart test `app/test/core/crypto/interop_vectors_test.dart` recomputes each with pointycastle and asserts byte equality; the web and CLI unit tests assert the same file. All three must agree before any UI work.

## Backend changes (`backend/src`)

| Change | Files |
|---|---|
| **Cookie refresh for web.** Requests carrying `X-Client: web`: login/refresh set `mv_refresh` (HttpOnly, SameSite=Strict, Path=/api/v1/auth, 7d, `Secure` only when `NODE_ENV=production` — Safari rejects Secure cookies on http://localhost) and omit `refreshToken` from JSON. Refresh reads body first (Flutter unchanged), else cookie. Cookie paths require the `X-Client` header (forces preflight = CSRF guard). | `main.ts` (cookie-parser, add `X-Client` to CORS headers), `modules/auth/auth.controller.ts`, `auth.service.ts`, `dto/refresh-token.dto.ts` (optional), new `dto/logout.dto.ts`; add `cookie-parser` dep |
| **Multiple sessions.** Remove the revoke-on-login block; logout revokes only the presented token (body or cookie), falling back to today's "all for this device" when none is sent; prune that user's expired tokens on login. | `auth.service.ts` |
| **Vault creation.** `CreateVaultDto` gains required client-generated `id` (UUID v4) so the client can encrypt it into `kekVerify`; insert with that id, 409 on conflict; base64 validation on salt/nonce fields. | `modules/vault/dto/create-vault.dto.ts`, `vault.service.ts` |
| **URL endpoint check.** `getMediaUrls` must find a `media_vault_access` row for (mediaId, vaultId) with `is_deleted=false`, else 404. | `modules/media/media.service.ts:225` |

Jest unit tests for each changed path (backend has none today). Companion one-liner in Flutter so phone logout doesn't end the web session: `blocs/auth/auth_cubit.dart:75` sends its `refreshToken` in the logout body.

## CLI fix (`migration-cli/src`)

`api-client.ts`: add `listVaults()`. `index.ts:52-58`: fetch the vault, use its `kekSalt`, derive with Argon2id (`hash-wasm`, same parameters), and **verify against `kekVerify` before uploading** (exit on wrong passphrase). `encryptor.ts`: replace `scryptSync` derivation. Test against `crypto-vectors.json`.

## Web app structure

```
web/src/
  lib/api/        client.ts (envelope unwrap, single-flight refresh, 429 backoff), endpoints.ts, types.ts
  lib/crypto/     crypto.worker.ts, cryptoClient.ts (typed RPC), argon2.ts, aesgcm.ts, base64.ts
  lib/media/      thumbStore.ts (IndexedDB), thumbLoader.ts (queue + object-URL LRU), imageProcessing.ts, exif.ts
  lib/upload/     uploadQueue.ts
  state/          authStore, vaultStore, uploadStore, selectionStore
  features/       auth/ unlock/ timeline/ albums/ viewer/ upload/ settings/
  components/ui/  Button, Dialog, Toast, Menu, Tooltip, Skeleton
web/tests/        unit/ (vitest)  e2e/ (playwright)  fixtures/
web/nginx.conf, web/Dockerfile   (static hosting + /api proxy + security headers)
```

### Inherited from the Flutter app (behaviour kept identical)

| Flutter | Web |
|---|---|
| `login_screen.dart` (device ID + password, remembered device ID) | `/login`; device ID remembered in localStorage |
| `passphrase_screen.dart` + `vault_picker_sheet.dart` + `VaultCryptoCubit.findMatches` | `/unlock`: derive for **every** vault, no early exit; one match opens directly; several → "Select vault" dialog listing only matches, no count; failure text always "Invalid passphrase"; label fallback "Vault N"; unchosen keys discarded |
| `timeline_screen.dart`, `media_grid.dart`, `month_header.dart` | `/timeline`: month-grouped grid, infinite scroll (prefetch at 70%) |
| `album_grid_screen.dart`, `album_card.dart`, `album_media_screen.dart` | `/albums`, `/albums/:id`; Liked first; unliked items leave Liked immediately |
| `MediaCubit.toggleLike` | optimistic like with rollback |
| `settings_screen.dart` | Lock vault, Clear cache, Logout |
| `auth_interceptor.dart` | Bearer token + refresh-and-retry on 401 |
| `cache_service.dart` (encrypted thumbnail cache) | IndexedDB cache holding the **server ciphertext as-is** keyed by media ID (still encrypted at rest, no second key needed, no cross-vault thrash) |

Not inherited (bugs): viewer stub, logout → nonexistent `/register`, album names never shown, concurrent-401 refresh race, clock-seeded RNG (web uses `crypto.getRandomValues`).

### Added for web

- **Viewer** (overlay on the current list via `?v=<id>`, so grid scroll is preserved and Back closes it): thumbnail shown instantly then 1080px preview; wheel/pinch/double-click zoom, drag pan; ←/→ (loads next page at the end), Esc, L like, D download, I info (date, dimensions, filename/GPS from `encryptedMeta`), F fullscreen. Download re-requests URLs at click time, decrypts the original, saves with its real filename. Videos: poster + badge + duration, download only.
- **Album names** decrypted; cover = first item of the album (the API cannot resolve `coverMediaId`).
- **Register** (`/register`): name, device ID, password (same rule as `register-device.dto.ts`, validated inline), invite code.
- **Owner tools** (shown only when the JWT role is `owner`; server still enforces):
  - *Create vault*: label + passphrase (confirmed, "cannot be recovered" warning) → random salt, `crypto.randomUUID()`, verify token, encrypted label.
  - *Invite device*: code shown once with copy + expiry.
  - *Albums*: create, rename, multi-select (hover checkbox, shift-range) → add to / remove from album.
  - *Upload*: drag-and-drop anywhere or file picker → bottom-right queue panel (per-file state, progress, retry, leave-page warning). Per file: EXIF date/GPS (fallback file date) → thumb 200px / preview 1080px JPEG matching `migration-cli/src/processor.ts` → fresh DEK → encrypt three tiers → `upload/init` → PUT to S3 (XHR for progress, `Content-Type: application/octet-stream`) → `upload/complete`. Dropping onto an album also adds to it. Video poster via `<video>` seek, grey placeholder if the codec is unsupported. 1 GB per-file cap (whole-file GCM needs 2× memory); larger files → CLI. HEIC accepted only where the browser can decode it, otherwise a clear per-file message.
- **Auto-lock** after inactivity (default 15 min; 5/15/60/never).

### Desktop UX

Left sidebar (Timeline, Albums, Settings; Upload for owners) + top bar with vault label and a Lock button; collapses to an icon rail under 1024px and stays usable on phone widths. Square-tile grid with column count from container width, row-virtualised, sticky month headers, skeleton tiles (no spinners per tile), explicit empty/error/retry states, toasts for actions, full keyboard access with visible focus, light/dark following the system with a manual toggle.

## Security model

- **Keys never on the main thread.** Worker holds KEK as a non-extractable `CryptoKey`; raw Argon2 output is zeroed after import; DEKs are unwrapped with `unwrapKey` (never exposed as bytes). Lock = terminate and recreate the worker, revoke all object URLs, clear the query cache. Reload always requires the passphrase.
- **Session.** Access token in memory only; refresh token in the httpOnly cookie; session restored on load via `/auth/refresh`. Refresh is serialised across tabs with `navigator.locks` so rotation cannot race.
- **Nothing decrypted is persisted.** IndexedDB holds ciphertext only; cleared on logout.
- **CSP (production build + nginx):** `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src blob:; connect-src 'self' <S3 bucket origin>; worker-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, plus `Referrer-Policy: no-referrer`, `nosniff`, COOP same-origin.
- **Deployment shape:** web and API same-origin (nginx serves the SPA and proxies `/api`), so no API CORS and SameSite=Strict works. Dev uses the Vite proxy for the same reason.
- Honest limit: a JS string passphrase cannot be zeroed; it is cleared from the input and never stored.

## Cross-browser handling

- 60-second thumbnail URLs: fetch each page's ciphertext immediately into IndexedDB; on a 403, refetch that page once for fresh URLs.
- S3 fetches run on the main thread (buffers transferred to the worker) — reliable in all engines and interceptable in tests.
- Rate limit is 100 req/min: page size 100, paced album/upload calls, viewer preloads one neighbour after a dwell, 429 → `Retry-After` backoff.
- IndexedDB failure (private windows, quota) → memory-only fallback.
- WebCrypto needs https or localhost; show a clear message otherwise.
- Safari: `-webkit-backdrop-filter`, fullscreen prefix fallback, non-Secure cookie in dev. Firefox: wheel `deltaMode` normalised. All: `:focus-visible`, `dvh`, `autocomplete` attributes (`username`/`current-password`/`new-password`; passphrase `off`).

## Build order

1. Step 0 vectors + Dart interop test.
2. Backend changes + Jest tests; Flutter logout one-liner.
3. CLI fix.
4. Web scaffold, crypto worker, API client, login/register, session restore.
5. Unlock, app shell, timeline, thumbnail cache.
6. Viewer, likes, albums (read).
7. Owner tools: create vault, invite, album management, upload.
8. Settings, auto-lock, states/a11y polish, CSP + nginx.
9. Three-engine E2E and manual pass.

Work on a new branch in ``; no commits unless asked.

## Verification

- **Unit (Vitest, Node WebCrypto):** vectors; round-trips; wrong key fails; CLI `encryptBlob`/`wrapDek` output decrypts with the web module (proves CLI → web without S3).
- **Flutter:** `flutter test` including the new interop test. **Backend:** `pnpm test`. **CLI:** vector test.
- **E2E (Playwright × chromium, firefox, webkit):** `docker compose up -d postgres`; global setup creates and migrates a separate `kuravault_e2e` database and starts a second backend on port 3100 with a high throttle limit (dev data untouched). S3 is emulated by Playwright route interception with an in-memory store (presigning works offline with placeholder credentials). Flow: register owner → login → create vault → unlock → upload JPEG/PNG/WebP → thumbnails render (`naturalWidth > 0`) under month headers → viewer open/arrow/zoom/like → Liked album → create album, add, remove → invite → second browser context registers as viewer (no owner tools, upload API 403) → lock wipes and redirects → reload keeps login but asks passphrase → wrong passphrase text → two vaults with one passphrase show the picker → logout in one context leaves the other signed in → forced 403 on a thumbnail recovers → cross-vault `urls` request returns 404.
- **Manual, real Chrome/Safari/Firefox:** trackpad pinch zoom, drag-and-drop upload, original download, password-manager behaviour, dark mode, 1280 and 1920 widths.

## Needed before real-bucket testing

Real AWS credentials in `backend/.env` and a bucket CORS rule allowing the web origin: methods GET and PUT, header `content-type`. Automated tests do not need this.

## Not included (flagged)

Cross-vault sharing UI (`POST /media/:id/vault-access`), album/photo deletion (no endpoints), in-browser video playback, HEIC conversion fallback, month scrubber (needs a month-list endpoint), removing `app/web/`, and fixing the Flutter clock-seeded RNG in `crypto_service.dart:110` (recommended follow-up).
