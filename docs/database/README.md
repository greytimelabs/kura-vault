# Database

PostgreSQL, accessed through TypeORM. The schema is created by migrations in
`backend/src/database/migrations/`; `synchronize` is off.

## Viewing the schema

[`schema.dbml`](schema.dbml) documents the schema as implemented, with a note
on every table. It is documentation, not something that is executed.

- **Diagram:** paste it into [dbdiagram.io](https://dbdiagram.io), or use
  *Import → DBML*.
- **Validate:** from the repository root,
  `npx -p @dbml/cli dbml2sql docs/database/schema.dbml --postgres`

When a migration changes the schema, update `schema.dbml` in the same change.
The migration and the entity files are the source of truth; if they and the
DBML disagree, the DBML is wrong.

## Tables

| Table | Entity (under `backend/src/modules/`) | Holds |
|---|---|---|
| `users` | `user/entities/user.entity.ts` | Registered devices: id, password hash, role, lockout state. One row per device, not per person |
| `refresh_tokens` | `user/entities/refresh-token.entity.ts` | Hashed refresh tokens with expiry and revocation |
| `key_groups` | `vault/entities/key-group.entity.ts` | Vaults: KDF salt, verification token, encrypted label |
| `user_vault_access` | `vault/entities/user-vault-access.entity.ts` | Which device can reach which vault, and with what permission |
| `invite_codes` | `vault/entities/invite-code.entity.ts` | Hashed one-time invite codes for a vault |
| `media` | `media/entities/media.entity.ts` | One row per photo or video: plaintext structural metadata, storage keys, IVs |
| `media_vault_access` | `media/entities/media-vault-access.entity.ts` | One row per (item, vault): the item's key wrapped for that vault, and encrypted metadata |
| `albums` | `album/entities/album.entity.ts` | Albums in a vault; `kind` is `regular` or `liked` |
| `album_media` | `album/entities/album-media.entity.ts` | Which items are in which album |

Enums are defined in `backend/src/common/types/index.ts`.

## Things worth knowing

- **`media` has no vault column.** An item belongs to a vault only through
  `media_vault_access`. That table is what makes one encrypted blob shareable
  across vaults.
- **`users` means devices.** The limit of 10 is enforced in application code.
- **Liked albums** are ordinary rows in `albums` with `kind = 'liked'` and an
  `owner_user_id`, one per device per vault, enforced by a partial unique
  index. Since "user" means device, likes do not follow a person across their
  devices. See [0003](../design/0003-liked-album-replaces-favorites.md).
- **`albums.media_count`** is a denormalised counter maintained in application
  code; there is no trigger.
- **Deletes cascade.** Every foreign key is `ON DELETE CASCADE`.

## Known gaps

Recorded so nobody is surprised; none are fixed yet.

1. **Two relationships are not enforced.** `albums.cover_media_id` and
   `invite_codes.used_by_user_id` are plain `uuid` columns with no foreign
   key. The DBML draws them so the diagram is complete.
2. **Deleting a vault can orphan media.** Removing a `key_groups` row cascades
   away its `media_vault_access` rows. An item whose only access row was in
   that vault is left behind with its blobs, and nothing can decrypt it.
3. **`media.file_size_bytes` is `bigint`.** The `pg` driver returns `bigint`
   as a string, but the entity types it as `number`.
4. **Missing indexes for common queries**, for example on
   `media (is_deleted, captured_at DESC)`.
5. **Two DBML limitations.** The partial unique index and the `CHECK`
   constraint on `albums` cannot be expressed in DBML and are described in the
   table note instead.

Two issues from the original review are resolved: the `uuid-ossp` extension is
now created by the initial migration, and per-media favourite flags were
replaced by the Liked album.

History: [0002](../design/0002-canonical-dbml-schema.md) explains why this
file exists and how it was derived.
