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
| `users` | `user/entities/user.entity.ts` | Accounts: username, password hash, role, access level, status, public keys, encrypted private keys, certificate |
| `user_invites` | `user/entities/user-invite.entity.ts` | Open invitations: token hash, the link secret sealed to the owner, the invitee's key binding |
| `refresh_tokens` | `user/entities/refresh-token.entity.ts` | Hashed refresh tokens with expiry and revocation |
| `vaults` | `vault/entities/vault.entity.ts` | Vaults: creator and encrypted label. No key material |
| `vault_members` | `vault/entities/vault-member.entity.ts` | Who can open which vault, with what permission, and their wrapped copy of the vault key |
| `albums` | `album/entities/album.entity.ts` | Albums in a vault; `kind` is `regular` or `liked`; the album key wrapped under the vault key |
| `album_members` | `album/entities/album-member.entity.ts` | One album shared with one user: permission and their wrapped copy of the album key |
| `album_media` | `album/entities/album-media.entity.ts` | Which items are in which album, and the item's key wrapped under the album key |
| `media` | `media/entities/media.entity.ts` | One row per photo or video: its vault, plaintext structural metadata, storage keys, IVs, the key wrapped under the vault key, encrypted metadata |

Enums are defined in `backend/src/common/types/index.ts`.

## Things worth knowing

- **Access is two tables.** `vault_members` and `album_members` decide who
  may do what, and each row carries the key that goes with the access.
  Deleting a row removes both. `users.role = 'owner'` grants nothing here.
- **No key is stored unwrapped.** See [crypto](../crypto/README.md) for what
  wraps what.
- **An item is in one vault** (`media.vault_id`). Its key can be wrapped more
  than once: under the vault key in `media`, and under an album key in each
  `album_media` row. An item uploaded by someone who had only an album has no
  vault wrap until a vault member adds one.
- **Several ids are chosen by the client** (users, vaults, regular albums,
  invites) or issued before the row exists (media), because ciphertext is
  bound to them. Inserts fail on a duplicate; nothing is upserted.
- **There is exactly one owner**, enforced by a partial unique index. The
  limit of 10 users is enforced in application code.
- **Liked albums** are ordinary rows in `albums` with `kind = 'liked'` and an
  `owner_user_id`, one per user per vault, enforced by a partial unique
  index. See [0003](../design/0003-liked-album-replaces-favorites.md).
- **`albums.media_count`** is a denormalised counter maintained in application
  code; there is no trigger.
- **Deletes cascade**, except `albums.created_by` and `media.uploaded_by`,
  which are set to null.
- **This schema replaced the earlier one outright.** There is one migration;
  data written by builds before October 2026 is not migrated.

## Known gaps

Recorded so nobody is surprised; none are fixed yet.

1. **One relationship is not enforced.** `albums.cover_media_id` is a plain
   `uuid` column with no foreign key. The DBML draws it so the diagram is
   complete.
2. **Nothing deletes media, vaults or users yet.** If a vault row is removed
   its media rows cascade away, but the blobs in storage are left behind.
3. **`media.file_size_bytes` is `bigint`.** The `pg` driver returns `bigint`
   as a string, but the entity types it as `number`.
4. **Missing indexes for common queries**, for example on
   `media (is_deleted, captured_at DESC)`.
5. **"At least one wrapped key per item" is not a database constraint.** The
   API enforces it on upload and when an item leaves an album.
6. **DBML limitations.** The partial unique indexes and the `CHECK`
   constraints cannot be expressed in DBML and are described in the table
   notes instead.

History: [0002](../design/0002-canonical-dbml-schema.md) explains why this
file exists and how it was derived;
[0005](../design/0005-accounts-keys-sharing.md) is the change that introduced
accounts with key pairs and sharing.
