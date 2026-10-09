# 0002 — Canonical DBML schema file

> **Decision record, September 2026.** Written before the work was done; paths are as they were then.
> `schema.dbml` has since moved to [`docs/database/schema.dbml`](../database/schema.dbml), and divergence 4 (per-media favourites) was resolved by [0003](0003-liked-album-replaces-favorites.md). Current notes: [database](../database/README.md).

## Context

The database schema for Kura Vault currently exists in **three places that disagree**:

1. the [system design doc](0001-system-design.md) §5.2 — 7 tables, hand-written SQL, says "Prisma"
2. `docs/archive/backend-implementation-plan.md` Phase 3 (lines 878–1304) — 9 TypeORM entities
3. `backend/src/database/migrations/1775240947512-InitialSchema.ts` — the code that actually runs

There is no single artifact anyone can look at to understand the data model, and no way to visualize it. The design doc is the one people read, and it is the one that is wrong — it omits `refresh_tokens` and `invite_codes` entirely, omits soft-delete and login-lockout columns, omits every `*_nonce` column, and names an ORM the project does not use (the project uses TypeORM; `docs/archive/build-instructions.md` explicitly says *not* Prisma).

**Outcome:** one `schema.dbml` file, importable into dbdiagram.io, that documents the schema as actually implemented — with the two missing foreign keys added so the diagram draws every real relationship.

## Decisions taken (confirmed with user)

- **Format: DBML** (dbdiagram.io's native language). Not runnable SQL — this is a documentation/diagram artifact. dbdiagram renders it via *Import > DBML* or by pasting into the editor.
- **Scope: implemented 9-table schema + the 2 missing FK constraints.**

## Source of truth

The migration file and the 9 entity files are **fully consistent with each other** — no drift. Verified by reading both directly:

| Entity file (under `backend/src/modules/`) | Table |
|---|---|
| `user/entities/user.entity.ts` | `users` |
| `user/entities/refresh-token.entity.ts` | `refresh_tokens` |
| `vault/entities/key-group.entity.ts` | `key_groups` |
| `vault/entities/user-vault-access.entity.ts` | `user_vault_access` |
| `vault/entities/invite-code.entity.ts` | `invite_codes` |
| `media/entities/media.entity.ts` | `media` |
| `media/entities/media-vault-access.entity.ts` | `media_vault_access` |
| `album/entities/album.entity.ts` | `albums` |
| `album/entities/album-media.entity.ts` | `album_media` |

Enums come from `backend/src/common/types/index.ts`.

## Deliverable

**Create one new file: `schema.dbml`** (repo root, next to `docker-compose.yml`, so it sits above both `backend/` and `migration-cli/` — it describes the shared database, not the backend alone).

Nothing else is modified. No code changes, no migration changes.

### File structure

```
Project + DatabaseType notes
3 enums
9 tables, each with a Note explaining its role
Refs (relationships)
TableGroups (visual clustering)
```

### Enums

Names must match TypeORM's generated PG type names exactly:

- `users_role_enum` — `owner`, `viewer`
- `user_vault_access_permission_enum` — `admin`, `view`
- `media_media_type_enum` — `photo`, `video`

### Tables — exact columns

Transcribe verbatim from the migration. Key details that are easy to get wrong:

- **`users`** — is really a *devices* table (one row per registered device, `MAX_DEVICES = 10` enforced in app code, not the DB). `device_id` unique. Has `password_hash`, `is_active`, `last_login_at`, `failed_login_attempts`, `locked_until`.
- **`key_groups`** — the vault table. `kek_salt`, `kek_verify`, `kek_verify_nonce` all `not null`; `label_encrypted` / `label_nonce` nullable. **No `updated_at`.**
- **`media`** — has **no `key_group_id`**. Vault scoping is *only* via `media_vault_access`. Note both `uploaded_at` and `created_at` are `@CreateDateColumn` (same value on insert). `file_size_bytes` is `bigint`; `aspect_ratio` is `double precision` (`float` in the entity); `year_month` is `varchar(7)` (`'2024-03'`).
- **`media_vault_access`** — surrogate `uuid` PK **plus** `unique (media_id, key_group_id)`. **No timestamp columns at all.** This is the envelope-encryption fan-out: one row per (photo × vault) holding the same DEK wrapped under that vault's KEK.
- **`album_media`** and **`user_vault_access`** — composite PKs, `(album_id, media_id)` and `(user_id, key_group_id)`.
- **`albums`** — `media_count` is a denormalized counter with no trigger.

In DBML, composite PKs use an `indexes { (col_a, col_b) [pk] }` block, not `[pk]` on each column.

### Refs

Nine FKs exist in the migration, **all `ON DELETE CASCADE`**:

```
albums.key_group_id            > key_groups.id
album_media.album_id           > albums.id
album_media.media_id           > media.id
refresh_tokens.user_id         > users.id
user_vault_access.user_id      > users.id
user_vault_access.key_group_id > key_groups.id
media_vault_access.media_id    > media.id
media_vault_access.key_group_id> key_groups.id
invite_codes.key_group_id      > key_groups.id
```

**Plus the two gap-fills** (per the confirmed decision). These columns exist today as bare `uuid` with no constraint, so dbdiagram would otherwise draw no line:

```
albums.cover_media_id        > media.id        [delete: set null]
invite_codes.used_by_user_id > users.id        [delete: set null]
```

`set null` (not cascade) is correct for both — deleting a photo should blank an album's cover, not delete the album; deleting a user should not erase the invite-code audit row.

### Indexes to include

All 8 declared indexes plus the implicit uniques. Transcribe as-is — do **not** "improve" them in this file; it documents what exists.

## Divergences to flag in file comments

The file should carry a short header comment noting these, so the next reader is not misled. These are observations to record, **not** changes to make:

1. **`uuid-ossp` extension is never created.** Every PK defaults to `uuid_generate_v4()`, but `grep -rn "CREATE EXTENSION" ` across the whole repo returns nothing — not in the migration, not in docker-compose, not in an init script. **The migration will fail on a fresh database.** This is a real latent bug worth a follow-up fix in the migration (or switching to the built-in `gen_random_uuid()`, which needs no extension on PG 13+ — and the project is on PG 18).
2. The design `.docx` §5.2 is stale — see Context above.
3. Deleting a `key_group` cascades away its `media_vault_access` rows, which **orphans the underlying `media` rows and their S3 blobs** with no cleanup path, and destroys the ability to decrypt those photos.
4. `media.is_favorite` / `is_archived` are **per-media, not per-vault** — a photo favorited in one vault appears favorited in every vault that can see it, which leaks a signal across the compartmentalization boundary the product is built on.
5. `file_size_bytes` is `bigint`; the `pg` driver returns it as a string, while the entity types it `number`.

## Verification

DBML is not executable, so verification is a parse/render check plus a diff against the source:

1. **Import into dbdiagram.io** — open dbdiagram.io, paste the file contents (or *Import > DBML*). It must parse with no errors and render 9 tables with 11 relationship lines (9 real + 2 added).
2. **Confirm no table or column was missed** — the table and column count must match the migration:
   ```bash
   # count tables in the migration
   grep -o 'CREATE TABLE "[a-z_]*"' \
     backend/src/database/migrations/1775240947512-InitialSchema.ts | sort
   # → must be exactly the 9 tables in schema.dbml
   ```
3. **Spot-check the widest table** — `media` has 22 columns; verify each against `media/entities/media.entity.ts`.
4. Optionally, validate locally without the web UI: `npx @dbml/cli dbml2sql schema.dbml --postgres` should emit valid SQL and exit 0.

## Out of scope

- Fixing the `uuid-ossp` bug (flag only — it is a migration change, and the user asked for a DDL file)
- Updating the `.docx` design plan
- Adding the actually-missing indexes the query patterns want (e.g. `media(is_deleted, captured_at DESC)`)
- Adding real FK constraints to the live schema via a new TypeORM migration — the DBML documents the intended relationships; making the database match is a separate change to propose afterward
