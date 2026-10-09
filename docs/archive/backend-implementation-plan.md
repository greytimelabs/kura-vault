> **Historical document.** Original backend build plan, April 2026. Kept unedited for reference; it is not maintained to match the code.
> Current state: [architecture](../architecture.md), [getting started](../getting-started.md). See also the [archive notes](README.md).

# Kura Vault - Implementation Plan for Claude Code

## PROJECT OVERVIEW

Kura Vault is an encrypted personal media storage and streaming system.
- **Backend**: NestJS + TypeORM + PostgreSQL 18
- **App**: Flutter (iOS, Android, Web, Desktop)
- **Runtime**: Node.js 24 LTS
- **Package Manager**: pnpm
- **Database**: PostgreSQL 18
- **Encryption**: Client-side AES-256-GCM with envelope encryption
- **Multi-vault**: 3-4 independent passphrases control separate album groups

## DIRECTORY STRUCTURE

```
kura-vault/
├── docker-compose.yml
├── .env.example
├── .env
├── backend/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── nest-cli.json
│   ├── .eslintrc.js
│   ├── .prettierrc
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── common/
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   └── roles.guard.ts
│   │   │   ├── decorators/
│   │   │   │   ├── roles.decorator.ts
│   │   │   │   ├── current-user.decorator.ts
│   │   │   │   └── current-vault.decorator.ts
│   │   │   ├── interceptors/
│   │   │   │   └── transform.interceptor.ts
│   │   │   ├── filters/
│   │   │   │   └── http-exception.filter.ts
│   │   │   ├── pipes/
│   │   │   │   └── validation.pipe.ts
│   │   │   ├── middleware/
│   │   │   │   ├── helmet.middleware.ts
│   │   │   │   ├── rate-limit.middleware.ts
│   │   │   │   └── correlation-id.middleware.ts
│   │   │   ├── constants/
│   │   │   │   └── index.ts
│   │   │   └── types/
│   │   │       └── index.ts
│   │   ├── config/
│   │   │   ├── database.config.ts
│   │   │   ├── jwt.config.ts
│   │   │   ├── s3.config.ts
│   │   │   ├── app.config.ts
│   │   │   └── validation.ts
│   │   ├── database/
│   │   │   ├── database.module.ts
│   │   │   ├── migrations/
│   │   │   │   └── (auto-generated)
│   │   │   └── seeds/
│   │   │       └── initial-seed.ts
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── strategies/
│   │   │   │   │   └── jwt.strategy.ts
│   │   │   │   └── dto/
│   │   │   │       ├── register-device.dto.ts
│   │   │   │       ├── login.dto.ts
│   │   │   │       └── refresh-token.dto.ts
│   │   │   ├── vault/
│   │   │   │   ├── vault.module.ts
│   │   │   │   ├── vault.controller.ts
│   │   │   │   ├── vault.service.ts
│   │   │   │   ├── entities/
│   │   │   │   │   ├── key-group.entity.ts
│   │   │   │   │   └── user-vault-access.entity.ts
│   │   │   │   └── dto/
│   │   │   │       ├── create-vault.dto.ts
│   │   │   │       └── generate-invite.dto.ts
│   │   │   ├── user/
│   │   │   │   ├── user.module.ts
│   │   │   │   ├── user.service.ts
│   │   │   │   ├── entities/
│   │   │   │   │   ├── user.entity.ts
│   │   │   │   │   └── refresh-token.entity.ts
│   │   │   │   └── dto/
│   │   │   ├── media/
│   │   │   │   ├── media.module.ts
│   │   │   │   ├── media.controller.ts
│   │   │   │   ├── media.service.ts
│   │   │   │   ├── entities/
│   │   │   │   │   ├── media.entity.ts
│   │   │   │   │   └── media-vault-access.entity.ts
│   │   │   │   └── dto/
│   │   │   │       ├── upload-init.dto.ts
│   │   │   │       ├── upload-complete.dto.ts
│   │   │   │       ├── query-media.dto.ts
│   │   │   │       └── add-vault-access.dto.ts
│   │   │   ├── album/
│   │   │   │   ├── album.module.ts
│   │   │   │   ├── album.controller.ts
│   │   │   │   ├── album.service.ts
│   │   │   │   ├── entities/
│   │   │   │   │   ├── album.entity.ts
│   │   │   │   │   └── album-media.entity.ts
│   │   │   │   └── dto/
│   │   │   │       ├── create-album.dto.ts
│   │   │   │       ├── update-album.dto.ts
│   │   │   │       └── add-media-to-album.dto.ts
│   │   │   └── storage/
│   │   │       ├── storage.module.ts
│   │   │       └── storage.service.ts
│   │   └── health/
│   │       ├── health.module.ts
│   │       └── health.controller.ts
│   └── test/
│       ├── jest-e2e.json
│       └── app.e2e-spec.ts
├── app/
│   ├── pubspec.yaml
│   ├── lib/
│   │   ├── main.dart
│   │   ├── app.dart
│   │   ├── core/
│   │   │   ├── crypto/
│   │   │   │   ├── crypto_service.dart
│   │   │   │   ├── key_derivation.dart
│   │   │   │   └── cache_crypto.dart
│   │   │   ├── network/
│   │   │   │   ├── api_client.dart
│   │   │   │   ├── api_endpoints.dart
│   │   │   │   └── interceptors/
│   │   │   │       ├── auth_interceptor.dart
│   │   │   │       └── error_interceptor.dart
│   │   │   ├── storage/
│   │   │   │   ├── secure_storage_service.dart
│   │   │   │   └── cache_service.dart
│   │   │   ├── auth/
│   │   │   │   └── auth_manager.dart
│   │   │   └── constants/
│   │   │       └── app_constants.dart
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── presentation/
│   │   │   │   │   ├── screens/
│   │   │   │   │   │   ├── passphrase_screen.dart
│   │   │   │   │   │   └── device_register_screen.dart
│   │   │   │   │   └── widgets/
│   │   │   │   ├── domain/
│   │   │   │   │   └── auth_repository.dart
│   │   │   │   └── data/
│   │   │   │       └── auth_remote_source.dart
│   │   │   ├── gallery/
│   │   │   │   ├── presentation/
│   │   │   │   │   ├── screens/
│   │   │   │   │   │   ├── timeline_screen.dart
│   │   │   │   │   │   └── album_grid_screen.dart
│   │   │   │   │   └── widgets/
│   │   │   │   │       ├── media_grid.dart
│   │   │   │   │       ├── encrypted_image.dart
│   │   │   │   │       └── month_header.dart
│   │   │   │   ├── domain/
│   │   │   │   │   └── media_repository.dart
│   │   │   │   └── data/
│   │   │   │       └── media_remote_source.dart
│   │   │   ├── viewer/
│   │   │   │   └── presentation/
│   │   │   │       └── screens/
│   │   │   │           └── photo_viewer_screen.dart
│   │   │   ├── albums/
│   │   │   │   ├── presentation/
│   │   │   │   │   ├── screens/
│   │   │   │   │   │   └── albums_screen.dart
│   │   │   │   │   └── widgets/
│   │   │   │   │       └── album_card.dart
│   │   │   │   ├── domain/
│   │   │   │   │   └── album_repository.dart
│   │   │   │   └── data/
│   │   │   │       └── album_remote_source.dart
│   │   │   └── settings/
│   │   │       └── presentation/
│   │   │           └── screens/
│   │   │               └── settings_screen.dart
│   │   ├── blocs/
│   │   │   ├── auth/
│   │   │   │   ├── auth_cubit.dart
│   │   │   │   └── auth_state.dart
│   │   │   ├── vault/
│   │   │   │   ├── vault_cubit.dart
│   │   │   │   └── vault_state.dart
│   │   │   ├── media/
│   │   │   │   ├── media_cubit.dart
│   │   │   │   └── media_state.dart
│   │   │   ├── album/
│   │   │   │   ├── album_cubit.dart
│   │   │   │   └── album_state.dart
│   │   │   └── crypto/
│   │   │       ├── vault_crypto_cubit.dart
│   │   │       └── vault_crypto_state.dart
│   │   └── routing/
│   │       └── app_router.dart
│   └── test/
└── migration-cli/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        ├── scanner.ts
        ├── encryptor.ts
        ├── uploader.ts
        └── progress.ts
```

---

## EXECUTION PHASES

Execute each phase in order. Each phase has specific files to create and validation steps.

---

## PHASE 1: Project Scaffolding + Docker

### Step 1.1: Create root project files

Create `kura-vault/.env.example`:
```env
# PostgreSQL
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=kuravault
POSTGRES_PASSWORD=CHANGE_ME_IN_PRODUCTION
POSTGRES_DB=kuravault

# JWT
JWT_SECRET=CHANGE_ME_GENERATE_A_64_CHAR_RANDOM_STRING
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# AWS S3
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=kura-vault-storage
S3_PRESIGNED_EXPIRY=60

# CloudFront
CLOUDFRONT_DOMAIN=your-cloudfront-domain
CLOUDFRONT_KEY_PAIR_ID=your-key-pair-id
CLOUDFRONT_PRIVATE_KEY_PATH=/app/keys/cloudfront-private-key.pem

# App
NODE_ENV=development
PORT=3000
CORS_ORIGINS=http://localhost:3000,http://localhost:8080

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# Password Hashing
HASH_SALT_ROUNDS=12
```

### Step 1.2: Create docker-compose.yml

Create `kura-vault/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:18-alpine
    container_name: kuravault-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-kuravault}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-kuravault_dev}
      POSTGRES_DB: ${POSTGRES_DB:-kuravault}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-kuravault} -d ${POSTGRES_DB:-kuravault}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - kuravault-net
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
      - /run/postgresql

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: development
    container_name: kuravault-api
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: development
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_USER: ${POSTGRES_USER:-kuravault}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-kuravault_dev}
      POSTGRES_DB: ${POSTGRES_DB:-kuravault}
      JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret-change-in-production-minimum-64-chars-long-string-here}
      JWT_EXPIRATION: ${JWT_EXPIRATION:-15m}
      JWT_REFRESH_EXPIRATION: ${JWT_REFRESH_EXPIRATION:-7d}
      PORT: 3000
      HASH_SALT_ROUNDS: 12
    ports:
      - "3000:3000"
    volumes:
      - ./backend/src:/app/src:ro
    networks:
      - kuravault-net
    security_opt:
      - no-new-privileges:true

volumes:
  pgdata:
    driver: local

networks:
  kuravault-net:
    driver: bridge
```

### Step 1.3: Create Backend Dockerfile (multi-stage, secured)

Create `kura-vault/backend/Dockerfile`:
```dockerfile
# ============================================
# Stage 1: Base - install dependencies only
# ============================================
FROM node:24-alpine AS base

# Security: run as non-root, add tini for signal handling
RUN apk add --no-cache tini \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && addgroup -g 1001 -S appgroup \
    && adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# Copy only dependency files first (layer caching)
COPY --chown=appuser:appgroup package.json pnpm-lock.yaml ./

# ============================================
# Stage 2: Development
# ============================================
FROM base AS development

RUN pnpm install --frozen-lockfile

COPY --chown=appuser:appgroup . .

USER appuser

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "run", "start:dev"]

# ============================================
# Stage 3: Build - compile TypeScript
# ============================================
FROM base AS build

RUN pnpm install --frozen-lockfile

COPY --chown=appuser:appgroup . .

RUN pnpm run build

# Prune dev dependencies after build
RUN pnpm prune --prod

# ============================================
# Stage 4: Production - minimal runtime image
# ============================================
FROM node:24-alpine AS production

# Security hardening
RUN apk add --no-cache tini \
    && addgroup -g 1001 -S appgroup \
    && adduser -u 1001 -S appuser -G appgroup \
    # Remove unnecessary binaries
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -rf /opt/yarn* \
    && rm -rf /usr/local/bin/yarn* \
    && rm -rf /usr/local/bin/npx*

WORKDIR /app

# Copy only production artifacts
COPY --from=build --chown=appuser:appgroup /app/dist ./dist
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/package.json ./

# Security: non-root user, read-only filesystem compatible
USER appuser

# Security headers via env
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

Create `kura-vault/backend/.dockerignore`:
```
node_modules
dist
.git
.gitignore
*.md
.env
.env.*
!.env.example
docker-compose*.yml
Dockerfile
.dockerignore
coverage
test
*.spec.ts
*.test.ts
.vscode
.idea
```

### Step 1.4: Initialize NestJS backend with pnpm

```bash
cd kura-vault/backend
pnpm init
pnpm add @nestjs/core @nestjs/common @nestjs/platform-express @nestjs/typeorm @nestjs/config @nestjs/jwt @nestjs/passport @nestjs/throttler
pnpm add typeorm pg passport passport-jwt bcrypt class-validator class-transformer helmet uuid
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/cloudfront-signer
pnpm add rxjs reflect-metadata
pnpm add -D typescript @types/node @types/express @types/bcrypt @types/passport-jwt @types/uuid
pnpm add -D @nestjs/cli @nestjs/schematics @nestjs/testing
pnpm add -D ts-node tsconfig-paths jest @types/jest ts-jest
pnpm add -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier
```

### Step 1.5: Create tsconfig.json

Create `kura-vault/backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["src/*"],
      "@common/*": ["src/common/*"],
      "@modules/*": ["src/modules/*"],
      "@config/*": ["src/config/*"]
    }
  }
}
```

Create `kura-vault/backend/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts"]
}
```

Create `kura-vault/backend/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

Create `kura-vault/backend/package.json` scripts section:
```json
{
  "name": "kura-vault-backend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,test}/**/*.ts\" --fix",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "typeorm": "ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js",
    "migration:generate": "pnpm typeorm migration:generate src/database/migrations/Migration -d src/config/database.config.ts",
    "migration:run": "pnpm typeorm migration:run -d src/config/database.config.ts",
    "migration:revert": "pnpm typeorm migration:revert -d src/config/database.config.ts"
  }
}
```

---

## PHASE 2: Backend - Configuration & Common

### Step 2.1: App Config

Create `kura-vault/backend/src/config/app.config.ts`:
```typescript
import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
}));
```

Create `kura-vault/backend/src/config/database.config.ts`:
```typescript
import { registerAs } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';

config();

export const databaseConfig = registerAs('database', () => ({
  type: 'postgres' as const,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  username: process.env.POSTGRES_USER || 'kuravault',
  password: process.env.POSTGRES_PASSWORD || 'kuravault_dev',
  database: process.env.POSTGRES_DB || 'kuravault',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  synchronize: false,  // NEVER true in production
  logging: process.env.NODE_ENV === 'development',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  extra: {
    max: 20,                    // connection pool max
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
}));

// For TypeORM CLI
const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  username: process.env.POSTGRES_USER || 'kuravault',
  password: process.env.POSTGRES_PASSWORD || 'kuravault_dev',
  database: process.env.POSTGRES_DB || 'kuravault',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  synchronize: false,
};

export default new DataSource(dataSourceOptions);
```

Create `kura-vault/backend/src/config/jwt.config.ts`:
```typescript
import { registerAs } from '@nestjs/config';

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  expiration: process.env.JWT_EXPIRATION || '15m',
  refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
}));
```

Create `kura-vault/backend/src/config/s3.config.ts`:
```typescript
import { registerAs } from '@nestjs/config';

export const s3Config = registerAs('s3', () => ({
  region: process.env.AWS_REGION || 'ap-south-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucketName: process.env.S3_BUCKET_NAME || 'kura-vault-storage',
  presignedExpiry: parseInt(process.env.S3_PRESIGNED_EXPIRY, 10) || 60,
  cloudfrontDomain: process.env.CLOUDFRONT_DOMAIN,
  cloudfrontKeyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
  cloudfrontPrivateKeyPath: process.env.CLOUDFRONT_PRIVATE_KEY_PATH,
}));
```

Create `kura-vault/backend/src/config/validation.ts`:
```typescript
import * as Joi from 'joi';

// NOTE: add `pnpm add joi` to dependencies
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  POSTGRES_HOST: Joi.string().required(),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  HASH_SALT_ROUNDS: Joi.number().default(12),
});
```

### Step 2.2: Common - Types, Constants, Guards, Decorators

Create `kura-vault/backend/src/common/types/index.ts`:
```typescript
export enum UserRole {
  OWNER = 'owner',
  VIEWER = 'viewer',
}

export enum VaultPermission {
  ADMIN = 'admin',
  VIEW = 'view',
}

export enum MediaType {
  PHOTO = 'photo',
  VIDEO = 'video',
}

export interface JwtPayload {
  sub: string;        // user id
  deviceId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest {
  user: JwtPayload;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

Create `kura-vault/backend/src/common/constants/index.ts`:
```typescript
export const MAX_DEVICES = 10;
export const INVITE_CODE_EXPIRY_HOURS = 24;
export const INVITE_CODE_LENGTH = 32;
export const MAX_UPLOAD_BATCH = 50;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const PRESIGNED_URL_EXPIRY_SECONDS = 60;
export const UPLOAD_URL_EXPIRY_SECONDS = 900; // 15 min
```

Create `kura-vault/backend/src/common/guards/jwt-auth.guard.ts`:
```typescript
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: TUser, info: any, context: ExecutionContext): TUser {
    if (err || !user) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
    return user;
  }
}
```

Create `kura-vault/backend/src/common/guards/roles.guard.ts`:
```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@common/types';
import { ROLES_KEY } from '@common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
```

Create `kura-vault/backend/src/common/decorators/roles.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@common/types';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

Create `kura-vault/backend/src/common/decorators/current-user.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@common/types';

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as JwtPayload;
    return data ? user?.[data] : user;
  },
);
```

Create `kura-vault/backend/src/common/filters/http-exception.filter.ts`:
```typescript
import {
  ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message || message;
    }

    // Log error details server-side but never leak to client
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} - ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // Generic message for 5xx - never expose internals
      message = 'Internal server error';
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

Create `kura-vault/backend/src/common/interceptors/transform.interceptor.ts`:
```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

Create `kura-vault/backend/src/common/middleware/correlation-id.middleware.ts`:
```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
```

---

## PHASE 3: Backend - Entities & Database

### Step 3.1: User Entity

Create `kura-vault/backend/src/modules/user/entities/user.entity.ts`:
```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { UserRole } from '@common/types';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'device_id', type: 'varchar', length: 255, unique: true })
  deviceId: string;

  /**
   * Password hash - bcrypt with per-user salt.
   * Used for device authentication (device_id + password).
   * The password is NOT the vault passphrase - it's a separate
   * authentication credential for the API.
   */
  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.VIEWER })
  role: UserRole;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

Create `kura-vault/backend/src/modules/user/entities/refresh-token.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Hashed refresh token - never store plaintext tokens.
   * Use SHA-256 hash of the actual token.
   */
  @Column({ name: 'token_hash', type: 'varchar', length: 128, unique: true })
  tokenHash: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'device_id', type: 'varchar', length: 255 })
  deviceId: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

### Step 3.2: Vault Entities

Create `kura-vault/backend/src/modules/vault/entities/key-group.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';

@Entity('key_groups')
export class KeyGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Unique Argon2id salt for this vault.
   * Not secret - sent to clients for KEK derivation.
   * Base64-encoded.
   */
  @Column({ name: 'kek_salt', type: 'text' })
  kekSalt: string;

  /**
   * A known string (vault UUID) encrypted with this vault's KEK.
   * Used to verify correct passphrase without storing passphrase.
   * Client decrypts this to confirm passphrase match.
   */
  @Column({ name: 'kek_verify', type: 'text' })
  kekVerify: string;

  /**
   * Nonce used for the kek_verify encryption.
   */
  @Column({ name: 'kek_verify_nonce', type: 'text' })
  kekVerifyNonce: string;

  /**
   * Encrypted vault label (e.g., "Family", "Friends").
   * Encrypted with this vault's KEK so server can't see vault names.
   */
  @Column({ name: 'label_encrypted', type: 'text', nullable: true })
  labelEncrypted: string | null;

  @Column({ name: 'label_nonce', type: 'text', nullable: true })
  labelNonce: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

Create `kura-vault/backend/src/modules/vault/entities/user-vault-access.entity.ts`:
```typescript
import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '@modules/user/entities/user.entity';
import { KeyGroup } from './key-group.entity';
import { VaultPermission } from '@common/types';

@Entity('user_vault_access')
export class UserVaultAccess {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  @Column({ type: 'enum', enum: VaultPermission, default: VaultPermission.VIEW })
  permission: VaultPermission;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

### Step 3.3: Media Entities

Create `kura-vault/backend/src/modules/media/entities/media.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { MediaType } from '@common/types';

@Entity('media')
@Index('idx_media_captured', ['capturedAt'])
@Index('idx_media_yearmonth', ['yearMonth'])
export class Media {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Structural metadata (plaintext for server-side queries) ──

  @Column({ name: 'captured_at', type: 'timestamptz', nullable: true })
  capturedAt: Date | null;

  @Column({ name: 'media_type', type: 'enum', enum: MediaType })
  mediaType: MediaType;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: number | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'aspect_ratio', type: 'float', nullable: true })
  aspectRatio: number | null;

  @Column({ name: 'year_month', type: 'varchar', length: 7, nullable: true })
  yearMonth: string | null;

  // ── S3 keys (paths to encrypted blobs) ──

  @Column({ name: 's3_key_thumb', type: 'text' })
  s3KeyThumb: string;

  @Column({ name: 's3_key_preview', type: 'text' })
  s3KeyPreview: string;

  @Column({ name: 's3_key_original', type: 'text' })
  s3KeyOriginal: string;

  // ── Encryption IVs (same across all vaults, since same DEK) ──

  @Column({ name: 'thumb_iv', type: 'text' })
  thumbIv: string;

  @Column({ name: 'preview_iv', type: 'text' })
  previewIv: string;

  @Column({ name: 'original_iv', type: 'text' })
  originalIv: string;

  // ── Flags ──

  @Column({ name: 'is_favorite', type: 'boolean', default: false })
  isFavorite: boolean;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived: boolean;

  @Column({ name: 'is_deleted', type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

Create `kura-vault/backend/src/modules/media/entities/media-vault-access.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Media } from './media.entity';
import { KeyGroup } from '@modules/vault/entities/key-group.entity';

@Entity('media_vault_access')
@Unique('uq_media_vault', ['mediaId', 'keyGroupId'])
@Index('idx_mva_vault', ['keyGroupId'])
@Index('idx_mva_media', ['mediaId'])
export class MediaVaultAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'media_id', type: 'uuid' })
  mediaId: string;

  @ManyToOne(() => Media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media: Media;

  @Column({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  /**
   * DEK encrypted with this vault's KEK.
   * Base64-encoded. ~64 bytes.
   */
  @Column({ name: 'encrypted_dek', type: 'text' })
  encryptedDek: string;

  @Column({ name: 'dek_nonce', type: 'text' })
  dekNonce: string;

  /**
   * Sensitive metadata (filename, GPS, camera, tags)
   * encrypted with this vault's KEK.
   * JSON string encrypted then base64-encoded.
   */
  @Column({ name: 'encrypted_meta', type: 'text', nullable: true })
  encryptedMeta: string | null;

  @Column({ name: 'meta_nonce', type: 'text', nullable: true })
  metaNonce: string | null;
}
```

### Step 3.4: Album Entities

Create `kura-vault/backend/src/modules/album/entities/album.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { KeyGroup } from '@modules/vault/entities/key-group.entity';

@Entity('albums')
@Index('idx_albums_vault', ['keyGroupId'])
export class Album {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  /**
   * Album name encrypted with this vault's KEK.
   * Server cannot see album names.
   */
  @Column({ name: 'name_encrypted', type: 'text' })
  nameEncrypted: string;

  @Column({ name: 'name_nonce', type: 'text' })
  nameNonce: string;

  @Column({ name: 'cover_media_id', type: 'uuid', nullable: true })
  coverMediaId: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'media_count', type: 'int', default: 0 })
  mediaCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

Create `kura-vault/backend/src/modules/album/entities/album-media.entity.ts`:
```typescript
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { Album } from './album.entity';
import { Media } from '@modules/media/entities/media.entity';

@Entity('album_media')
@Index('idx_album_media_album', ['albumId'])
@Index('idx_album_media_media', ['mediaId'])
export class AlbumMedia {
  @PrimaryColumn({ name: 'album_id', type: 'uuid' })
  albumId: string;

  @PrimaryColumn({ name: 'media_id', type: 'uuid' })
  mediaId: string;

  @ManyToOne(() => Album, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'album_id' })
  album: Album;

  @ManyToOne(() => Media, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'media_id' })
  media: Media;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt: Date;
}
```

### Step 3.5: Invite Code Entity

Create `kura-vault/backend/src/modules/vault/entities/invite-code.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { KeyGroup } from './key-group.entity';

@Entity('invite_codes')
export class InviteCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * SHA-256 hash of the invite code.
   * Never store plaintext invite codes.
   */
  @Column({ name: 'code_hash', type: 'varchar', length: 128, unique: true })
  codeHash: string;

  @Column({ name: 'key_group_id', type: 'uuid' })
  keyGroupId: string;

  @ManyToOne(() => KeyGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'key_group_id' })
  keyGroup: KeyGroup;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @Column({ name: 'used_by_user_id', type: 'uuid', nullable: true })
  usedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
```

---

## PHASE 4: Backend - Auth Module (Device ID + Password + Salt)

### Step 4.1: DTOs

Create `kura-vault/backend/src/modules/auth/dto/register-device.dto.ts`:
```typescript
import { IsString, IsNotEmpty, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /**
   * Unique device identifier.
   * On mobile: from device_info_plus or similar.
   * Must be deterministic per device.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  deviceId: string;

  /**
   * Password for this device registration.
   * NOT the vault passphrase.
   * Used for API authentication.
   */
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
    { message: 'Password must contain uppercase, lowercase, number, and special character' },
  )
  password: string;

  /**
   * One-time invite code (required for non-first-user registration).
   * First device registered becomes the owner.
   */
  @IsString()
  @IsOptional()
  inviteCode?: string;
}
```

Create `kura-vault/backend/src/modules/auth/dto/login.dto.ts`:
```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
```

Create `kura-vault/backend/src/modules/auth/dto/refresh-token.dto.ts`:
```typescript
import { IsString, IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
```

### Step 4.2: Auth Service

Create `kura-vault/backend/src/modules/auth/auth.service.ts`:
```typescript
import {
  Injectable, UnauthorizedException, ConflictException,
  BadRequestException, Logger, ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from '@modules/user/entities/user.entity';
import { RefreshToken } from '@modules/user/entities/refresh-token.entity';
import { InviteCode } from '@modules/vault/entities/invite-code.entity';
import { UserVaultAccess } from '@modules/vault/entities/user-vault-access.entity';
import { JwtPayload, UserRole, VaultPermission } from '@common/types';
import { MAX_DEVICES } from '@common/constants';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;
  private readonly maxFailedAttempts = 5;
  private readonly lockoutDurationMinutes = 15;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(InviteCode) private readonly inviteCodeRepo: Repository<InviteCode>,
    @InjectRepository(UserVaultAccess) private readonly userVaultAccessRepo: Repository<UserVaultAccess>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = this.configService.get<number>('HASH_SALT_ROUNDS', 12);
  }

  /**
   * Register a new device.
   * First device becomes owner. Subsequent devices require invite code.
   */
  async registerDevice(dto: RegisterDeviceDto): Promise<{ message: string }> {
    // Check if device already registered
    const existingUser = await this.userRepo.findOne({
      where: { deviceId: dto.deviceId },
    });
    if (existingUser) {
      throw new ConflictException('Device already registered');
    }

    // Check max devices
    const deviceCount = await this.userRepo.count();
    if (deviceCount >= MAX_DEVICES) {
      throw new BadRequestException(`Maximum of ${MAX_DEVICES} devices reached`);
    }

    // Determine role
    let role = UserRole.VIEWER;
    let vaultId: string | null = null;

    if (deviceCount === 0) {
      // First device = owner
      role = UserRole.OWNER;
    } else {
      // Subsequent devices need invite code
      if (!dto.inviteCode) {
        throw new BadRequestException('Invite code required for device registration');
      }

      const inviteCodeHash = crypto
        .createHash('sha256')
        .update(dto.inviteCode)
        .digest('hex');

      const invite = await this.inviteCodeRepo.findOne({
        where: {
          codeHash: inviteCodeHash,
          isUsed: false,
          expiresAt: MoreThan(new Date()),
        },
      });

      if (!invite) {
        throw new BadRequestException('Invalid or expired invite code');
      }

      vaultId = invite.keyGroupId;

      // Mark invite as used (within transaction in production)
      invite.isUsed = true;
      await this.inviteCodeRepo.save(invite);
    }

    // Hash password with bcrypt (auto-generates salt)
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    // Create user
    const user = this.userRepo.create({
      name: dto.name,
      deviceId: dto.deviceId,
      passwordHash,
      role,
    });
    const savedUser = await this.userRepo.save(user);

    // If invite code provided, grant vault access
    if (vaultId) {
      const access = this.userVaultAccessRepo.create({
        userId: savedUser.id,
        keyGroupId: vaultId,
        permission: VaultPermission.VIEW,
      });
      await this.userVaultAccessRepo.save(access);
    }

    this.logger.log(`Device registered: ${dto.deviceId}, role: ${role}`);
    return { message: 'Device registered successfully' };
  }

  /**
   * Authenticate with device_id + password.
   * Returns JWT access token + refresh token.
   */
  async login(dto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    user: { id: string; name: string; role: UserRole };
  }> {
    const user = await this.userRepo.findOne({
      where: { deviceId: dto.deviceId },
    });

    if (!user) {
      // Constant-time response to prevent user enumeration
      await bcrypt.hash('dummy', this.saltRounds);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account locked. Try again in ${remainingMinutes} minutes`,
      );
    }

    // Check if active
    if (!user.isActive) {
      throw new ForbiddenException('Device has been deactivated');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      // Increment failed attempts
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= this.maxFailedAttempts) {
        user.lockedUntil = new Date(
          Date.now() + this.lockoutDurationMinutes * 60 * 1000,
        );
        user.failedLoginAttempts = 0;
        this.logger.warn(`Device locked due to failed attempts: ${dto.deviceId}`);
      }
      await this.userRepo.save(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts on success
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await this.userRepo.save(user);

    // Generate tokens
    const payload: JwtPayload = {
      sub: user.id,
      deviceId: user.deviceId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    // Generate refresh token
    const refreshTokenValue = crypto.randomBytes(64).toString('hex');
    const refreshTokenHash = crypto
      .createHash('sha256')
      .update(refreshTokenValue)
      .digest('hex');

    // Revoke any existing refresh tokens for this device
    await this.refreshTokenRepo.update(
      { userId: user.id, deviceId: user.deviceId, isRevoked: false },
      { isRevoked: true },
    );

    // Save new refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const refreshToken = this.refreshTokenRepo.create({
      tokenHash: refreshTokenHash,
      userId: user.id,
      deviceId: user.deviceId,
      expiresAt,
    });
    await this.refreshTokenRepo.save(refreshToken);

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m'),
      user: { id: user.id, name: user.name, role: user.role },
    };
  }

  /**
   * Refresh access token using refresh token.
   * Implements rotation: old refresh token is revoked, new one issued.
   */
  async refreshAccessToken(refreshTokenValue: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
  }> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(refreshTokenValue)
      .digest('hex');

    const storedToken = await this.refreshTokenRepo.findOne({
      where: { tokenHash, isRevoked: false },
      relations: ['user'],
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      if (storedToken) {
        // Possible token reuse attack - revoke all tokens for this user
        await this.refreshTokenRepo.update(
          { userId: storedToken.userId },
          { isRevoked: true },
        );
        this.logger.warn(
          `Refresh token reuse detected for user: ${storedToken.userId}`,
        );
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = storedToken.user;
    if (!user.isActive) {
      throw new ForbiddenException('Device has been deactivated');
    }

    // Revoke current refresh token (rotation)
    storedToken.isRevoked = true;
    await this.refreshTokenRepo.save(storedToken);

    // Generate new tokens
    const payload: JwtPayload = {
      sub: user.id,
      deviceId: user.deviceId,
      role: user.role,
    };

    const newAccessToken = this.jwtService.sign(payload);
    const newRefreshTokenValue = crypto.randomBytes(64).toString('hex');
    const newRefreshTokenHash = crypto
      .createHash('sha256')
      .update(newRefreshTokenValue)
      .digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const newRefreshToken = this.refreshTokenRepo.create({
      tokenHash: newRefreshTokenHash,
      userId: user.id,
      deviceId: user.deviceId,
      expiresAt,
    });
    await this.refreshTokenRepo.save(newRefreshToken);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshTokenValue,
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m'),
    };
  }

  /**
   * Logout - revoke all refresh tokens for device.
   */
  async logout(userId: string, deviceId: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { userId, deviceId, isRevoked: false },
      { isRevoked: true },
    );
  }
}
```

### Step 4.3: JWT Strategy

Create `kura-vault/backend/src/modules/auth/strategies/jwt.strategy.ts`:
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@modules/user/entities/user.entity';
import { JwtPayload } from '@common/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Verify user still exists and is active
    const user = await this.userRepo.findOne({
      where: { id: payload.sub, deviceId: payload.deviceId, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found or deactivated');
    }

    return {
      sub: user.id,
      deviceId: user.deviceId,
      role: user.role,
    };
  }
}
```

### Step 4.4: Auth Controller

Create `kura-vault/backend/src/modules/auth/auth.controller.ts`:
```typescript
import {
  Controller, Post, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/types';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDeviceDto) {
    return this.authService.registerDevice(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshAccessToken(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: JwtPayload) {
    await this.authService.logout(user.sub, user.deviceId);
    return { message: 'Logged out successfully' };
  }
}
```

### Step 4.5: Auth Module

Create `kura-vault/backend/src/modules/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '@modules/user/entities/user.entity';
import { RefreshToken } from '@modules/user/entities/refresh-token.entity';
import { InviteCode } from '@modules/vault/entities/invite-code.entity';
import { UserVaultAccess } from '@modules/vault/entities/user-vault-access.entity';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRATION', '15m') },
      }),
    }),
    TypeOrmModule.forFeature([User, RefreshToken, InviteCode, UserVaultAccess]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

---

## PHASE 5: Backend - Vault, Media, Album, Storage Modules

### Step 5.1: Storage Service (S3 pre-signed URLs)

Create `kura-vault/backend/src/modules/storage/storage.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PRESIGNED_URL_EXPIRY_SECONDS, UPLOAD_URL_EXPIRY_SECONDS } from '@common/constants';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('s3.region'),
      credentials: {
        accessKeyId: this.configService.get<string>('s3.accessKeyId'),
        secretAccessKey: this.configService.get<string>('s3.secretAccessKey'),
      },
    });
    this.bucketName = this.configService.get<string>('s3.bucketName');
  }

  /**
   * Generate pre-signed PUT URL for uploading encrypted blobs.
   * Client uploads directly to S3 - API never touches media bytes.
   */
  async generateUploadUrl(s3Key: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
      ContentType: 'application/octet-stream', // encrypted blobs are opaque
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
    });
  }

  /**
   * Generate pre-signed GET URL for downloading encrypted blobs.
   * Short expiry (60s) since content is encrypted anyway.
   */
  async generateDownloadUrl(s3Key: string): Promise<string> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });
  }

  /**
   * Delete an encrypted blob from S3.
   */
  async deleteObject(s3Key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });
      await this.s3Client.send(command);
    } catch (error) {
      this.logger.error(`Failed to delete S3 object: ${s3Key}`, error);
      throw error;
    }
  }

  /**
   * Generate S3 key path for media.
   * Format: {vaultId}/{mediaId}/{tier}.enc
   */
  generateS3Key(vaultId: string, mediaId: string, tier: 'thumb' | 'preview' | 'original'): string {
    return `${vaultId}/${mediaId}/${tier}.enc`;
  }
}
```

Create `kura-vault/backend/src/modules/storage/storage.module.ts`:
```typescript
import { Module, Global } from '@nestjs/common';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
```

### Step 5.2: Vault Service & Controller

Create `kura-vault/backend/src/modules/vault/vault.service.ts`:
```typescript
import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as crypto from 'crypto';
import { KeyGroup } from './entities/key-group.entity';
import { UserVaultAccess } from './entities/user-vault-access.entity';
import { InviteCode } from './entities/invite-code.entity';
import { VaultPermission } from '@common/types';
import { INVITE_CODE_EXPIRY_HOURS, INVITE_CODE_LENGTH } from '@common/constants';
import { CreateVaultDto } from './dto/create-vault.dto';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    @InjectRepository(KeyGroup) private readonly keyGroupRepo: Repository<KeyGroup>,
    @InjectRepository(UserVaultAccess) private readonly userVaultAccessRepo: Repository<UserVaultAccess>,
    @InjectRepository(InviteCode) private readonly inviteCodeRepo: Repository<InviteCode>,
  ) {}

  /**
   * List all vaults - returns only id, salt, and verification data.
   * Clients try each vault to see which passphrase matches.
   */
  async listVaults(): Promise<Array<{
    id: string;
    kekSalt: string;
    kekVerify: string;
    kekVerifyNonce: string;
    labelEncrypted: string | null;
    labelNonce: string | null;
  }>> {
    const vaults = await this.keyGroupRepo.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return vaults.map((v) => ({
      id: v.id,
      kekSalt: v.kekSalt,
      kekVerify: v.kekVerify,
      kekVerifyNonce: v.kekVerifyNonce,
      labelEncrypted: v.labelEncrypted,
      labelNonce: v.labelNonce,
    }));
  }

  /**
   * Create a new vault. Owner only.
   * Client sends the kek_salt, kek_verify (encrypted vault ID), and encrypted label.
   */
  async createVault(userId: string, dto: CreateVaultDto): Promise<KeyGroup> {
    const vault = this.keyGroupRepo.create({
      kekSalt: dto.kekSalt,
      kekVerify: dto.kekVerify,
      kekVerifyNonce: dto.kekVerifyNonce,
      labelEncrypted: dto.labelEncrypted || null,
      labelNonce: dto.labelNonce || null,
    });
    const savedVault = await this.keyGroupRepo.save(vault);

    // Grant admin access to creator
    const access = this.userVaultAccessRepo.create({
      userId,
      keyGroupId: savedVault.id,
      permission: VaultPermission.ADMIN,
    });
    await this.userVaultAccessRepo.save(access);

    this.logger.log(`Vault created: ${savedVault.id} by user: ${userId}`);
    return savedVault;
  }

  /**
   * Generate invite code for a vault.
   * Returns the plaintext code (shown to user once).
   */
  async generateInviteCode(userId: string, vaultId: string): Promise<{ code: string; expiresAt: Date }> {
    // Verify user has admin access to this vault
    const access = await this.userVaultAccessRepo.findOne({
      where: { userId, keyGroupId: vaultId, permission: VaultPermission.ADMIN },
    });
    if (!access) {
      throw new ForbiddenException('Admin access required to generate invite codes');
    }

    const code = crypto.randomBytes(INVITE_CODE_LENGTH).toString('hex');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INVITE_CODE_EXPIRY_HOURS);

    const invite = this.inviteCodeRepo.create({
      codeHash,
      keyGroupId: vaultId,
      expiresAt,
    });
    await this.inviteCodeRepo.save(invite);

    return { code, expiresAt };
  }

  /**
   * Check if user has access to vault.
   */
  async checkAccess(userId: string, vaultId: string): Promise<UserVaultAccess | null> {
    return this.userVaultAccessRepo.findOne({
      where: { userId, keyGroupId: vaultId },
    });
  }

  /**
   * Get vaults accessible by user.
   */
  async getUserVaults(userId: string): Promise<string[]> {
    const accesses = await this.userVaultAccessRepo.find({
      where: { userId },
    });
    return accesses.map((a) => a.keyGroupId);
  }
}
```

Create `kura-vault/backend/src/modules/vault/dto/create-vault.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateVaultDto {
  @IsString()
  @IsNotEmpty()
  kekSalt: string;

  @IsString()
  @IsNotEmpty()
  kekVerify: string;

  @IsString()
  @IsNotEmpty()
  kekVerifyNonce: string;

  @IsString()
  @IsOptional()
  labelEncrypted?: string;

  @IsString()
  @IsOptional()
  labelNonce?: string;
}
```

Create `kura-vault/backend/src/modules/vault/vault.controller.ts`:
```typescript
import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { VaultService } from './vault.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@common/types';
import { CreateVaultDto } from './dto/create-vault.dto';

@Controller('vaults')
@UseGuards(JwtAuthGuard)
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get()
  async listVaults() {
    return this.vaultService.listVaults();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async createVault(@CurrentUser() user: JwtPayload, @Body() dto: CreateVaultDto) {
    return this.vaultService.createVault(user.sub, dto);
  }

  @Post(':id/invite')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async generateInvite(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) vaultId: string,
  ) {
    return this.vaultService.generateInviteCode(user.sub, vaultId);
  }
}
```

Create `kura-vault/backend/src/modules/vault/vault.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { KeyGroup } from './entities/key-group.entity';
import { UserVaultAccess } from './entities/user-vault-access.entity';
import { InviteCode } from './entities/invite-code.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KeyGroup, UserVaultAccess, InviteCode])],
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
```

### Step 5.3: Media Service & Controller

Create `kura-vault/backend/src/modules/media/dto/upload-init.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsEnum, IsOptional, IsNumber, IsUUID } from 'class-validator';
import { MediaType } from '@common/types';

export class UploadInitDto {
  @IsUUID()
  vaultId: string;

  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsOptional()
  @IsString()
  capturedAt?: string;  // ISO date string

  @IsOptional()
  @IsNumber()
  width?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number;

  @IsOptional()
  @IsNumber()
  fileSizeBytes?: number;
}
```

Create `kura-vault/backend/src/modules/media/dto/upload-complete.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class UploadCompleteDto {
  @IsUUID()
  mediaId: string;

  @IsUUID()
  vaultId: string;

  /**
   * DEK encrypted with the vault's KEK. Base64.
   */
  @IsString()
  @IsNotEmpty()
  encryptedDek: string;

  @IsString()
  @IsNotEmpty()
  dekNonce: string;

  @IsString()
  @IsNotEmpty()
  thumbIv: string;

  @IsString()
  @IsNotEmpty()
  previewIv: string;

  @IsString()
  @IsNotEmpty()
  originalIv: string;

  /**
   * Sensitive metadata encrypted with vault KEK. Base64.
   */
  @IsString()
  encryptedMeta: string;

  @IsString()
  metaNonce: string;
}
```

Create `kura-vault/backend/src/modules/media/dto/query-media.dto.ts`:
```typescript
import { IsOptional, IsUUID, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryMediaDto {
  @IsUUID()
  vaultId: string;

  @IsOptional()
  @IsUUID()
  albumId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  yearMonth?: string;  // e.g., '2024-03'
}
```

Create `kura-vault/backend/src/modules/media/dto/add-vault-access.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsUUID, IsOptional } from 'class-validator';

export class AddVaultAccessDto {
  @IsUUID()
  targetVaultId: string;

  @IsString()
  @IsNotEmpty()
  encryptedDek: string;

  @IsString()
  @IsNotEmpty()
  dekNonce: string;

  @IsOptional()
  @IsString()
  encryptedMeta?: string;

  @IsOptional()
  @IsString()
  metaNonce?: string;
}
```

Create `kura-vault/backend/src/modules/media/media.service.ts`:
```typescript
import {
  Injectable, NotFoundException, ForbiddenException, Logger, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Media } from './entities/media.entity';
import { MediaVaultAccess } from './entities/media-vault-access.entity';
import { StorageService } from '@modules/storage/storage.service';
import { VaultService } from '@modules/vault/vault.service';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { AddVaultAccessDto } from './dto/add-vault-access.dto';
import { PaginatedResponse } from '@common/types';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectRepository(Media) private readonly mediaRepo: Repository<Media>,
    @InjectRepository(MediaVaultAccess) private readonly mvaRepo: Repository<MediaVaultAccess>,
    private readonly storageService: StorageService,
    private readonly vaultService: VaultService,
  ) {}

  /**
   * Initialize upload: generate media ID and pre-signed S3 upload URLs.
   * Client uploads encrypted blobs directly to S3.
   */
  async initUpload(userId: string, dto: UploadInitDto): Promise<{
    mediaId: string;
    uploadUrls: { thumb: string; preview: string; original: string };
  }> {
    // Verify user has admin access to vault
    const access = await this.vaultService.checkAccess(userId, dto.vaultId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required to upload');
    }

    const mediaId = uuidv4();
    const thumbKey = this.storageService.generateS3Key(dto.vaultId, mediaId, 'thumb');
    const previewKey = this.storageService.generateS3Key(dto.vaultId, mediaId, 'preview');
    const originalKey = this.storageService.generateS3Key(dto.vaultId, mediaId, 'original');

    const [thumbUrl, previewUrl, originalUrl] = await Promise.all([
      this.storageService.generateUploadUrl(thumbKey),
      this.storageService.generateUploadUrl(previewKey),
      this.storageService.generateUploadUrl(originalKey),
    ]);

    return {
      mediaId,
      uploadUrls: { thumb: thumbUrl, preview: previewUrl, original: originalUrl },
    };
  }

  /**
   * Complete upload: store metadata and encrypted DEK.
   * Called after client has uploaded all 3 tiers to S3.
   */
  async completeUpload(userId: string, dto: UploadCompleteDto): Promise<Media> {
    const access = await this.vaultService.checkAccess(userId, dto.vaultId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    const capturedAt = dto['capturedAt'] ? new Date(dto['capturedAt']) : null;
    const yearMonth = capturedAt
      ? `${capturedAt.getFullYear()}-${String(capturedAt.getMonth() + 1).padStart(2, '0')}`
      : null;

    // Create media record
    const media = this.mediaRepo.create({
      id: dto.mediaId,
      mediaType: dto['mediaType'] || 'photo',
      capturedAt,
      yearMonth,
      width: dto['width'] || null,
      height: dto['height'] || null,
      fileSizeBytes: dto['fileSizeBytes'] || null,
      durationSeconds: dto['durationSeconds'] || null,
      aspectRatio: dto['width'] && dto['height'] ? dto['width'] / dto['height'] : null,
      s3KeyThumb: this.storageService.generateS3Key(dto.vaultId, dto.mediaId, 'thumb'),
      s3KeyPreview: this.storageService.generateS3Key(dto.vaultId, dto.mediaId, 'preview'),
      s3KeyOriginal: this.storageService.generateS3Key(dto.vaultId, dto.mediaId, 'original'),
      thumbIv: dto.thumbIv,
      previewIv: dto.previewIv,
      originalIv: dto.originalIv,
    });
    const savedMedia = await this.mediaRepo.save(media);

    // Create vault access with encrypted DEK
    const mva = this.mvaRepo.create({
      mediaId: savedMedia.id,
      keyGroupId: dto.vaultId,
      encryptedDek: dto.encryptedDek,
      dekNonce: dto.dekNonce,
      encryptedMeta: dto.encryptedMeta || null,
      metaNonce: dto.metaNonce || null,
    });
    await this.mvaRepo.save(mva);

    return savedMedia;
  }

  /**
   * Query media for a vault with pagination.
   * Returns metadata + encrypted DEKs + pre-signed download URLs.
   */
  async queryMedia(userId: string, dto: QueryMediaDto): Promise<PaginatedResponse<any>> {
    const access = await this.vaultService.checkAccess(userId, dto.vaultId);
    if (!access) {
      throw new ForbiddenException('No access to this vault');
    }

    const page = dto.page || 1;
    const limit = dto.limit || 50;
    const skip = (page - 1) * limit;

    const qb = this.mvaRepo
      .createQueryBuilder('mva')
      .innerJoinAndSelect('mva.media', 'media')
      .where('mva.key_group_id = :vaultId', { vaultId: dto.vaultId })
      .andWhere('media.is_deleted = false');

    if (dto.yearMonth) {
      qb.andWhere('media.year_month = :yearMonth', { yearMonth: dto.yearMonth });
    }

    if (dto.albumId) {
      qb.innerJoin('album_media', 'am', 'am.media_id = media.id AND am.album_id = :albumId', {
        albumId: dto.albumId,
      });
    }

    qb.orderBy('media.captured_at', 'DESC', 'NULLS LAST')
      .skip(skip)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    // Generate pre-signed URLs for thumbnails
    const data = await Promise.all(
      items.map(async (mva) => {
        const thumbUrl = await this.storageService.generateDownloadUrl(mva.media.s3KeyThumb);
        return {
          id: mva.media.id,
          mediaType: mva.media.mediaType,
          capturedAt: mva.media.capturedAt,
          yearMonth: mva.media.yearMonth,
          width: mva.media.width,
          height: mva.media.height,
          aspectRatio: mva.media.aspectRatio,
          durationSeconds: mva.media.durationSeconds,
          thumbIv: mva.media.thumbIv,
          encryptedDek: mva.encryptedDek,
          dekNonce: mva.dekNonce,
          encryptedMeta: mva.encryptedMeta,
          metaNonce: mva.metaNonce,
          thumbUrl,
        };
      }),
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get pre-signed URLs for preview and original tiers.
   */
  async getMediaUrls(userId: string, mediaId: string, vaultId: string): Promise<{
    previewUrl: string;
    originalUrl: string;
    previewIv: string;
    originalIv: string;
  }> {
    const access = await this.vaultService.checkAccess(userId, vaultId);
    if (!access) {
      throw new ForbiddenException('No access to this vault');
    }

    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('Media not found');
    }

    const [previewUrl, originalUrl] = await Promise.all([
      this.storageService.generateDownloadUrl(media.s3KeyPreview),
      this.storageService.generateDownloadUrl(media.s3KeyOriginal),
    ]);

    return {
      previewUrl,
      originalUrl,
      previewIv: media.previewIv,
      originalIv: media.originalIv,
    };
  }

  /**
   * Add cross-vault access for a photo.
   * Requires admin on target vault.
   */
  async addVaultAccess(userId: string, mediaId: string, dto: AddVaultAccessDto): Promise<void> {
    const access = await this.vaultService.checkAccess(userId, dto.targetVaultId);
    if (!access || access.permission !== 'admin') {
      throw new ForbiddenException('Admin access required on target vault');
    }

    // Verify media exists
    const media = await this.mediaRepo.findOne({ where: { id: mediaId } });
    if (!media) {
      throw new NotFoundException('Media not found');
    }

    // Check if already exists
    const existing = await this.mvaRepo.findOne({
      where: { mediaId, keyGroupId: dto.targetVaultId },
    });
    if (existing) {
      throw new BadRequestException('Media already accessible from this vault');
    }

    const mva = this.mvaRepo.create({
      mediaId,
      keyGroupId: dto.targetVaultId,
      encryptedDek: dto.encryptedDek,
      dekNonce: dto.dekNonce,
      encryptedMeta: dto.encryptedMeta || null,
      metaNonce: dto.metaNonce || null,
    });
    await this.mvaRepo.save(mva);
  }
}
```

Create `kura-vault/backend/src/modules/media/media.controller.ts`:
```typescript
import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload, UserRole } from '@common/types';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { AddVaultAccessDto } from './dto/add-vault-access.dto';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload/init')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async initUpload(@CurrentUser() user: JwtPayload, @Body() dto: UploadInitDto) {
    return this.mediaService.initUpload(user.sub, dto);
  }

  @Post('upload/complete')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async completeUpload(@CurrentUser() user: JwtPayload, @Body() dto: UploadCompleteDto) {
    return this.mediaService.completeUpload(user.sub, dto);
  }

  @Get()
  async queryMedia(@CurrentUser() user: JwtPayload, @Query() dto: QueryMediaDto) {
    return this.mediaService.queryMedia(user.sub, dto);
  }

  @Get(':id/urls')
  async getMediaUrls(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) mediaId: string,
    @Query('vaultId', ParseUUIDPipe) vaultId: string,
  ) {
    return this.mediaService.getMediaUrls(user.sub, mediaId, vaultId);
  }

  @Post(':id/vault-access')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  async addVaultAccess(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) mediaId: string,
    @Body() dto: AddVaultAccessDto,
  ) {
    return this.mediaService.addVaultAccess(user.sub, mediaId, dto);
  }
}
```

Create `kura-vault/backend/src/modules/media/media.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { Media } from './entities/media.entity';
import { MediaVaultAccess } from './entities/media-vault-access.entity';
import { VaultModule } from '@modules/vault/vault.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Media, MediaVaultAccess]),
    VaultModule,
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
```

### Step 5.4: Album Module (create similarly)

Create album service with CRUD for albums, add/remove media to albums.
Follow the same pattern as media module:
- `album.service.ts`: create, update, list (by vault), add media, remove media
- `album.controller.ts`: REST endpoints with guards
- `album.module.ts`: wire up

Key album endpoints:
- `GET /albums?vaultId=X` - list albums for vault
- `POST /albums` - create album (owner only)
- `PUT /albums/:id` - update album (owner only)
- `POST /albums/:id/media` - add media to album (owner only)
- `DELETE /albums/:id/media/:mediaId` - remove media from album (owner only)

### Step 5.5: Health Check

Create `kura-vault/backend/src/health/health.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

---

## PHASE 6: Backend - App Module & Main

### Step 6.1: App Module

Create `kura-vault/backend/src/app.module.ts`:
```typescript
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { appConfig } from '@config/app.config';
import { databaseConfig } from '@config/database.config';
import { jwtConfig } from '@config/jwt.config';
import { s3Config } from '@config/s3.config';
import { CorrelationIdMiddleware } from '@common/middleware/correlation-id.middleware';
import { GlobalExceptionFilter } from '@common/filters/http-exception.filter';
import { TransformInterceptor } from '@common/interceptors/transform.interceptor';
import { AuthModule } from '@modules/auth/auth.module';
import { VaultModule } from '@modules/vault/vault.module';
import { MediaModule } from '@modules/media/media.module';
import { AlbumModule } from '@modules/album/album.module';
import { StorageModule } from '@modules/storage/storage.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, jwtConfig, s3Config],
      envFilePath: ['.env'],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        synchronize: false,
        logging: config.get('app.nodeEnv') === 'development',
        ssl: config.get('app.nodeEnv') === 'production' ? { rejectUnauthorized: true } : false,
      }),
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([{
        ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
        limit: config.get<number>('THROTTLE_LIMIT', 100),
      }]),
    }),

    // Feature modules
    AuthModule,
    VaultModule,
    MediaModule,
    AlbumModule,
    StorageModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

### Step 6.2: Main entry

Create `kura-vault/backend/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  // CORS
  app.enableCors({
    origin: config.get<string[]>('app.corsOrigins'),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
    credentials: true,
    maxAge: 3600,
  });

  // Global validation pipe
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Strip unknown properties
      forbidNonWhitelisted: true, // Throw on unknown properties
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      disableErrorMessages: config.get('app.nodeEnv') === 'production',
    }),
  );

  const port = config.get<number>('app.port', 3000);
  await app.listen(port);
  logger.log(`Kura Vault API running on port ${port}`);
}

bootstrap();
```

---

## PHASE 7: Generate TypeORM Migration

After all entities are created, generate the initial migration:

```bash
cd backend
pnpm typeorm migration:generate src/database/migrations/InitialSchema -d src/config/database.config.ts
pnpm typeorm migration:run -d src/config/database.config.ts
```

---

## PHASE 8: Flutter App (see flutter-plan.md)

Refer to `flutter-plan.md` for the complete Flutter implementation plan including:
- Crypto service (Argon2id, AES-256-GCM, envelope encryption)
- State management with BLoC (Cubits)
- Gallery UI with virtual scroll
- Encrypted image widget and cache
- Passphrase unlock flow
- Biometric unlock

---

## PHASE 9: Migration CLI (see migration-cli-plan.md)

Refer to `migration-cli-plan.md` for the bulk upload CLI tool:
- Folder scanning with glob
- EXIF extraction
- Thumbnail/preview generation (Sharp + ffmpeg)
- Client-side encryption
- Parallel S3 upload with resume support

---

## SECURITY CHECKLIST

Before deploying, verify all of these:

### Authentication & Authorization
- [ ] Passwords hashed with bcrypt + auto-generated salt (12 rounds min)
- [ ] JWT tokens are short-lived (15 min)
- [ ] Refresh tokens are hashed (SHA-256) before storage
- [ ] Refresh token rotation on use (old revoked)
- [ ] Refresh token reuse detection (revoke all on reuse)
- [ ] Account lockout after 5 failed attempts (15 min)
- [ ] Constant-time comparison for auth (bcrypt handles this)
- [ ] Device registration is invite-only after first device

### API Security
- [ ] Helmet security headers on all responses
- [ ] CORS restricted to known origins
- [ ] Rate limiting (100 req/min default)
- [ ] Input validation with class-validator (whitelist + forbidNonWhitelisted)
- [ ] UUID validation on all ID parameters
- [ ] Global exception filter (never leak stack traces)
- [ ] Correlation ID for request tracing
- [ ] API prefix versioning (/api/v1)

### Database Security
- [ ] No synchronize in production (migrations only)
- [ ] Parameterized queries (TypeORM handles this)
- [ ] SSL connections in production
- [ ] Connection pooling with timeouts
- [ ] No plaintext passwords or tokens stored

### Docker Security
- [ ] Multi-stage build (minimal production image)
- [ ] Non-root user (appuser:1001)
- [ ] Tini as init process (proper signal handling)
- [ ] .dockerignore excludes sensitive files
- [ ] no-new-privileges security opt
- [ ] Read-only filesystem where possible
- [ ] Health checks defined

### Encryption (Client-Side)
- [ ] AES-256-GCM for all encryption
- [ ] Unique DEK per photo (32-byte CSPRNG)
- [ ] KEK derived via Argon2id (t=3, m=64MB)
- [ ] KEK never stored in plaintext on disk
- [ ] DEK only in memory for milliseconds during decrypt
- [ ] GCM auth tags verified on every decrypt
- [ ] Cache encrypted with HKDF-derived cache key
- [ ] Keys zeroed on app lock (fillRange(0))

### S3 & Network
- [ ] S3 bucket fully private (no public access)
- [ ] Pre-signed URLs with short expiry (60s download, 15m upload)
- [ ] HTTPS everywhere
- [ ] VPC endpoint for ECS→S3 (no internet path)
- [ ] CloudFront OAC for client→S3 access

---

## VALIDATION STEPS

After each phase, run these checks:

### Phase 1-6 (Backend):
```bash
cd backend
pnpm build              # TypeScript compiles
pnpm lint               # No lint errors
docker compose up -d    # Containers start
curl localhost:3000/api/v1/health  # Returns { status: 'ok' }
```

### Phase 7 (Migration):
```bash
pnpm typeorm migration:run  # Tables created
```

### Integration test:
```bash
# Register first device (becomes owner)
curl -X POST localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Owner Device","deviceId":"device-001","password":"SecureP@ss123!"}'

# Login
curl -X POST localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"device-001","password":"SecureP@ss123!"}'
# Should return accessToken + refreshToken
```
