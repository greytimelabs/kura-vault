# 0003 — Per-user "Liked" album replaces media.is_favorite / is_archived

> **Decision record, September 2026.** Written before the work was done; implemented in commit `1998f63`.
> `schema.dbml` now lives at [`docs/database/schema.dbml`](../database/schema.dbml).

## Context
`media.is_favorite` and `media.is_archived` are stored once per photo, so a like is visible to every vault and every member that can see the photo (known issue 4 in `schema.dbml`). A like should be personal. In a shared vault, two users each keep their own likes.

Decisions made with the user:
- **Liked is a system album.** Each user gets one per vault, stored in `albums` / `album_media`, so it reuses album counts, covers and the album list.
- **Archive is dropped entirely.** Nothing replaces it.
- **"User" means device.** `users` is really a devices table, so likes are per device. Liking on a phone won't show on the same person's tablet. This is accepted for now.
- **Edit `1775240947512-InitialSchema.ts` in place.** No new migration.
- **Scope covers the backend, `schema.dbml` and the Flutter app.**

## Backend (`backend/src`)

### 1. Types and entities
- **`common/types/index.ts`:** add `export enum AlbumKind { REGULAR = 'regular', LIKED = 'liked' }`.
- **`modules/media/entities/media.entity.ts`:** delete the `isFavorite` and `isArchived` columns.
- **`modules/album/entities/album.entity.ts`:**
  - `kind`: enum `AlbumKind`, default `regular`.
  - `ownerUserId`: uuid, nullable, `@ManyToOne(() => User, { onDelete: 'CASCADE' })`. Empty means a shared vault album; set means private to that user.
  - `nameEncrypted` / `nameNonce`: become nullable. The Liked album has no stored name; the app labels it.
  - `@Index('uq_albums_liked_owner_vault', ['ownerUserId', 'keyGroupId'], { unique: true, where: "kind = 'liked'" })`
  - `@Check('chk_albums_kind', "(kind = 'regular' AND name_encrypted IS NOT NULL AND name_nonce IS NOT NULL) OR (kind = 'liked' AND owner_user_id IS NOT NULL)")`

### 2. Migration (edit InitialSchema in place)
- Remove `is_favorite` and `is_archived` from `CREATE TABLE "media"`.
- Add the `albums_kind_enum` type, the new `albums` columns and check, the partial unique index, and the FK `albums.owner_user_id → users.id ON DELETE CASCADE`. Mirror all of it in `down()`.
- **Keep names in sync with the entities.** Point a scratch empty DB at the edited entities, run `pnpm migration:generate`, and copy the generated SQL (with its hashed FK/PK names) into InitialSchema. Keep the class name and timestamp, then delete the generated file.
- **Also add `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` at the top of `up()`.** This is known issue 1. Without it the migration can't run on a fresh DB, so nothing here could be verified.
- **Existing local DBs must be reset.** Drop and recreate the `public` schema, then `pnpm migration:run`. `migration:revert` won't work because the edited `down()` no longer matches what was applied.

### 3. `modules/album/album.service.ts`
- **`getOrCreateLikedAlbum(userId, vaultId)`** (private): find `{ kind: LIKED, ownerUserId, keyGroupId }`. If missing, insert it. On a unique-violation (`23505`) from a concurrent create, fetch it again.
- **`listAlbums`:**
  - Call `getOrCreateLikedAlbum` first so Liked always shows.
  - Return only `ownerUserId IS NULL OR ownerUserId = userId` (TypeORM `where` array with `IsNull()`).
  - Put the Liked album first, then `sortOrder` and `createdAt`.
- **New `likeMedia(userId, vaultId, mediaId)` / `unlikeMedia(...)`:**
  - Any vault permission is enough (`checkAccess` non-null); viewers can like.
  - Require a `media_vault_access` row for (media, vault) whose media is not deleted, otherwise 404. `AlbumModule` needs `TypeOrmModule.forFeature([..., MediaVaultAccess])`.
  - Both calls are idempotent.
  - The insert uses `.orIgnore()`, and `media_count` goes up only when a row was actually inserted.
  - `media_count` changes use `albumRepo.increment` / `decrement`, not read-modify-save.
- **Pull the insert and delete into shared helpers** used by `addMedia` / `removeMedia` too. `addMedia` then also gets the check that the media belongs to the album's vault, which it lacks today.
- **Protect Liked albums from the existing admin endpoints.** `updateAlbum`, `addMedia` and `removeMedia`:
  - Return 404 when `album.ownerUserId` is set and isn't the caller.
  - Return 400 when `album.kind === LIKED`, since the like endpoints must be used instead.

### 4. `modules/album/album.controller.ts` and DTO
- **New `dto/like-media.dto.ts`:** `{ @IsUUID() vaultId }`.
- **`PUT /albums/liked/media/:mediaId`** takes a body `{ vaultId }` and likes the photo.
- **`DELETE /albums/liked/media/:mediaId?vaultId=`** unlikes it.
- **Both use `JwtAuthGuard` only**, with no `RolesGuard` / `@Roles(OWNER)`, so viewers can like.

### 5. `modules/media/media.service.ts` → `queryMedia`
- **Check the `albumId` filter before querying.** Load the album and require:
  - `album.keyGroupId === dto.vaultId`
  - `ownerUserId` is null or equals `userId`

  Otherwise return 404. Today anyone can pass any album id, which would expose another user's likes.
- **Add `isLiked` to each returned item.** After the page loads, look up the caller's Liked album for this vault; don't create one on a read. If it exists, run one `SELECT media_id FROM album_media WHERE album_id = :liked AND media_id IN (:...ids)` and mark matching items.
- `MediaService` injects `Repository<Album>` and `Repository<AlbumMedia>` (add both to `MediaModule` `forFeature`). No module import cycle.

## schema.dbml
- **`media`:** remove the two flag lines and the "Flags. Per-media" comment.
- **`albums`:**
  - Add `kind albums_kind_enum` and `owner_user_id uuid`, and make the name columns nullable.
  - Add the partial unique index and a note about the check.
  - Update the table note: shared albums vs. per-user Liked albums.
- **Enums and refs:**
  - Add `Enum albums_kind_enum { regular liked }`.
  - Add `Ref: albums.owner_user_id > users.id [delete: cascade]` to the real-FK section. The header count goes from 9 to 10.
- **Known issues:**
  - Delete issue 4 and renumber the rest.
  - Remove issue 1 (uuid-ossp), since the extension is now created.
  - Add a note on `users` that likes are per device.
- **Check:** `npx @dbml/cli dbml2sql schema.dbml --postgres` passes.

## Flutter (`app/lib`)
The cubits call `ApiClient` directly. `*_repository.dart` / `*_remote_source.dart` are never built (dead code), so follow the cubit pattern.

- **`core/network/api_endpoints.dart`:** add `static String likedMedia(String mediaId) => '/albums/liked/media/$mediaId';`
- **`blocs/album/album_state.dart`:**
  - `AlbumItem` gets a `kind` field.
  - `nameEncrypted` / `nameNonce` become nullable.
  - Add `bool get isLiked => kind == 'liked'`.
- **`blocs/media/media_state.dart`:**
  - `MediaItem` gets `final bool isLiked` (parsed with a `false` default) and `copyWith({bool? isLiked})`.
  - **Fix `props`** to use `items` instead of `items.length`. Otherwise a like toggle keeps the same length, Equatable treats the states as equal, and nothing rebuilds.
- **`blocs/media/media_cubit.dart`:** add `toggleLike({required String vaultId, required String mediaId})`.
  - Flip `isLiked` on that item right away.
  - Call `PUT` or `DELETE likedMedia`.
  - Undo the flip if the call fails.
- **`features/viewer/presentation/screens/photo_viewer_screen.dart`:** add a heart `IconButton` to `AppBar.actions`.
  - Filled or outlined from `context.select<MediaCubit, bool>` (find the item by `widget.mediaId`).
  - Tapping calls `toggleLike` with `activeVaultId`.
  - Image decryption in this screen is still a placeholder; that is out of scope.
- **`features/albums/presentation/widgets/album_card.dart`:** when `album.isLiked`, show a heart icon and the label "Liked" instead of the album icon.
- **`features/gallery/presentation/screens/album_grid_screen.dart`** (the routed screen): replace its inline card copy with `AlbumCard`.
- **New `features/gallery/presentation/screens/album_media_screen.dart`:**
  - Takes `albumId` and `isLiked`.
  - Calls `context.read<MediaCubit>().loadMedia(vaultId, albumId: albumId)` and renders with `MediaGrid`.
  - For the Liked album, it shows only `items.where((i) => i.isLiked)`, so a photo unliked in the viewer disappears on return.
- **`routing/app_router.dart`:** add `GoRoute('/gallery/albums/:albumId')` inside the `ShellRoute`, passing `isLiked` via `extra`.
  - This route doesn't exist today, so tapping any album currently fails.
  - `TimelineScreen` reloads in `initState` when you go back to `/gallery`, so sharing the app-wide `MediaCubit` is safe.

## Verification
1. **Backend build and migration**
   - Reset the local DB, then run `pnpm migration:run` and `pnpm build`.
   - Run `pnpm migration:generate` again: it must report no changes, which confirms entities and migration match.
   - Run `\d albums` and `\d media` in psql.
2. **API flow with curl, using two devices A and B that share one vault** (join via the invite code):
   - **Setup:** A calls `POST /media/upload/complete` to create a media row; S3 blobs aren't needed for this.
   - **Viewer can like:** B, with `view` permission, calls `PUT /albums/liked/media/:id` and gets 200. Repeating it is still 200, and `media_count` stays 1.
   - **Likes are private:** `GET /albums?vaultId=` for A shows only A's Liked album (count 0). For B it shows B's (count 1). `GET /media?vaultId=` shows `isLiked` true for B and false for A.
   - **Album filter is checked:** A calls `GET /media?vaultId=&albumId=<B's liked id>` and gets 404. A calls `PUT /albums/<B's liked id>` and gets 404.
   - **Unlike:** B calls `DELETE .../liked/media/:id?vaultId=`. The count goes back to 0, and a second delete is still 200.
3. **DBML:** `npx @dbml/cli dbml2sql schema.dbml --postgres`.
4. **Flutter:** `flutter analyze` is clean.
   - Run the app and heart a photo in the viewer.
   - The Albums tab shows "Liked · 1 items". Opening it shows the photo. Unliking it and going back removes it.
