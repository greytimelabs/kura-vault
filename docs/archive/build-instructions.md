> **Historical document.** Original build order and security rules given to the coding agent, April 2026. Kept unedited for reference; it is not maintained to match the code.
> The security rules live on in [security](../security.md). See also the [archive notes](README.md).

# CLAUDE CODE - KURA VAULT BUILD INSTRUCTIONS

## READ THESE FILES FIRST (in order)

1. `backend-implementation-plan.md` — Full backend plan with every file, every entity, every service
2. `flutter-plan.md` — Flutter app with crypto, gallery, providers
3. `migration-cli-plan.md` — Bulk upload CLI tool

## PROJECT CONTEXT

Building an encrypted personal media storage system called "Kura Vault."

**Stack:**
- Backend: NestJS + TypeORM (NOT Prisma) + PostgreSQL 18
- App: Flutter (BLoC state management)
- Runtime: Node.js 24 LTS
- Package Manager: pnpm
- Docker: multi-stage Dockerfile, docker-compose for local dev

**Key Architecture Decisions:**
- Client-side AES-256-GCM encryption (server never sees plaintext media)
- Envelope encryption: per-photo DEK wrapped with vault KEK
- Multi-vault: 3-4 independent passphrases for compartmentalized albums
- Photos can exist in multiple albums across different vaults
- Authentication: device_id + password (bcrypt with salt, 12 rounds)
- JWT (15 min) + refresh token rotation (7 day, SHA-256 hashed)
- S3 pre-signed URLs for direct upload/download (API never touches media bytes)

## BUILD ORDER

### Phase 1: Scaffolding
- Create root directory structure
- Create docker-compose.yml (postgres 18 + backend)
- Create backend Dockerfile (multi-stage: base → dev → build → production)
- Create .dockerignore, .env.example
- Initialize NestJS project with pnpm
- Create tsconfig.json, nest-cli.json

### Phase 2: Configuration
- Create all config files (app, database, jwt, s3)
- Create env validation with Joi

### Phase 3: Common Layer
- Types and enums
- Constants
- JWT auth guard
- Roles guard
- Decorators (CurrentUser, Roles)
- Global exception filter (never leak stack traces)
- Transform interceptor (standard response wrapper)
- Correlation ID middleware

### Phase 4: Entities
- User entity (device_id, password_hash, role, lockout fields)
- RefreshToken entity (hashed token, expiry, revocation)
- KeyGroup entity (vault with salt, verify token)
- UserVaultAccess entity (user-vault junction with permission)
- InviteCode entity (hashed code, expiry)
- Media entity (structural metadata, S3 keys, IVs)
- MediaVaultAccess entity (per-vault wrapped DEK junction)
- Album entity (encrypted name, vault reference)
- AlbumMedia entity (album-media many-to-many)

### Phase 5: Auth Module
- RegisterDevice (first = owner, subsequent = invite code required)
- Login (device_id + password, bcrypt verify, lockout on 5 fails)
- Refresh token (rotation, reuse detection)
- Logout (revoke refresh tokens)
- JWT strategy (verify user active on each request)

### Phase 6: Feature Modules
- Storage service (S3 pre-signed URL generation)
- Vault service & controller (list, create, invite)
- Media service & controller (upload init/complete, query with pagination, URLs, cross-vault access)
- Album service & controller (CRUD, add/remove media)
- Health check

### Phase 7: App Module & Main
- Wire all modules together
- Helmet security headers
- CORS configuration
- Global validation pipe (whitelist, forbidNonWhitelisted)
- Rate limiting (throttler)
- API prefix /api/v1

### Phase 8: Database Migration
- Generate TypeORM migration from entities
- Run migration

### Phase 9: Flutter App
- Follow flutter-plan.md
- Start with crypto service (most critical)
- Then API client
- Then passphrase screen
- Then gallery UI

### Phase 10: Migration CLI
- Follow migration-cli-plan.md

## STRICT SECURITY RULES

1. **NEVER store plaintext passwords** - use bcrypt with auto-generated salt (12+ rounds)
2. **NEVER store plaintext tokens** - SHA-256 hash refresh tokens before storage
3. **NEVER use synchronize: true** in TypeORM config (migrations only)
4. **NEVER log sensitive data** - no passwords, tokens, or keys in logs
5. **NEVER expose stack traces** - global exception filter returns generic errors for 5xx
6. **ALWAYS validate input** - class-validator with whitelist + forbidNonWhitelisted
7. **ALWAYS use parameterized queries** - TypeORM handles this, never concatenate SQL
8. **ALWAYS check vault access** - every media/album endpoint verifies user has vault access
9. **ALWAYS use UUIDs** - never sequential IDs (prevents enumeration)
10. **ALWAYS hash invite codes** - SHA-256 before storage, like tokens
11. **Account lockout** - 5 failed attempts = 15 min lockout
12. **Refresh token rotation** - revoke old token on use, detect reuse attacks
13. **CORS restricted** - only configured origins
14. **Rate limiting** - 100 req/min default
15. **Docker non-root** - run as appuser (UID 1001)
16. **no-new-privileges** - Docker security opt on all containers
17. **Helmet** - security headers on all responses
18. **Constant-time auth** - bcrypt compare even on non-existent users
19. **Pre-signed URLs** - short expiry (60s download, 15min upload)
20. **Read-only containers** - PostgreSQL with tmpfs for temp files

## TESTING VALIDATION

After building backend, verify with these curl commands:

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Register first device (becomes owner)
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Dev Machine","deviceId":"dev-001","password":"Str0ngP@ssw0rd!!"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"dev-001","password":"Str0ngP@ssw0rd!!"}'

# Use the returned accessToken for authenticated requests:
# curl -H "Authorization: Bearer <token>" http://localhost:3000/api/v1/vaults
```
