# Archive: original build plans

These are the step-by-step plans the first version of Kura Vault was built
from in April 2026. They are kept unedited, apart from a banner and updated
file names, because they contain reasoning and detail that is not written down
anywhere else.

**They are not maintained.** Where they disagree with the code, the code and
the [current docs](../README.md) are right.

| File | Originally | Contents |
|---|---|---|
| [backend-implementation-plan.md](backend-implementation-plan.md) | `IMPLEMENTATION_PLAN.md` | Every backend file, entity and service, phase by phase, plus a security checklist |
| [flutter-plan.md](flutter-plan.md) | `FLUTTER_PLAN.md` | Flutter app structure, crypto service, cubits, encrypted image widget |
| [migration-cli-plan.md](migration-cli-plan.md) | `MIGRATION_CLI_PLAN.md` | Bulk import pipeline and time estimates |
| [build-instructions.md](build-instructions.md) | `CLAUDE_CODE_INSTRUCTIONS.md` | Build order and the 20 security rules given to the coding agent |

## Where the plans and the code differ

- **Paths.** The plans assume a parent folder containing `kura-vault/`. That
  folder is now the repository root.
- **Web client.** The plans use Flutter for every platform. The browser client
  is now a separate React app in `web/`
  ([0004](../design/0004-react-web-client.md)).
- **Key derivation in the CLI.** The CLI plan and its first version used scrypt
  with a salt made from the vault id. All clients now use Argon2id with the
  vault's stored salt ([crypto](../crypto/README.md)).
- **Favourites and archive.** The `is_favorite` and `is_archived` columns on
  `media` are gone ([0003](../design/0003-liked-album-replaces-favorites.md)).
- **Vault creation.** The client generates the vault id, because the
  verification token is that id encrypted with the vault key.
- **Sessions.** Web clients keep the refresh token in an httpOnly cookie and a
  device can hold more than one session.
- **Storage.** Any S3-compatible service works (`S3_ENDPOINT`); CloudFront
  settings exist in config but downloads use S3 pre-signed URLs.
- **PostgreSQL version.** The plans say 18; `docker-compose.yml` runs
  `postgres:17-alpine`.
- **Compose.** Only PostgreSQL runs in compose; the backend service is
  commented out and is run with `pnpm start:dev`.
