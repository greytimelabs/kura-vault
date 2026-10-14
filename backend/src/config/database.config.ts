import './load-env';
import { readFileSync } from 'fs';
import { registerAs } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';

type PostgresConnectionOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/**
 * TLS to PostgreSQL, set explicitly (never inferred from NODE_ENV):
 * - `disable` (default): plain connection, for a database on the same private network
 * - `require`: encrypted, but the server certificate is not checked
 * - `verify-full`: encrypted and the certificate is verified, against POSTGRES_SSL_CA_FILE if set
 */
function sslOptions(env: NodeJS.ProcessEnv): PostgresConnectionOptions['ssl'] {
  switch (env.POSTGRES_SSL || 'disable') {
    case 'require':
      return { rejectUnauthorized: false };
    case 'verify-full':
      return {
        rejectUnauthorized: true,
        ...(env.POSTGRES_SSL_CA_FILE ? { ca: readFileSync(env.POSTGRES_SSL_CA_FILE, 'utf8') } : {}),
      };
    default:
      return false;
  }
}

/** One definition for the app and the TypeORM CLI, so the two cannot drift apart. */
export function dataSourceOptions(env: NodeJS.ProcessEnv = process.env): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: env.POSTGRES_HOST || 'localhost',
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    username: env.POSTGRES_USER || 'kuravault',
    password: env.POSTGRES_PASSWORD || 'kuravault_dev',
    database: env.POSTGRES_DB || 'kuravault',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    synchronize: false, // NEVER true: schema changes are migrations
    migrationsRun: env.MIGRATIONS_RUN === 'true',
    logging: env.NODE_ENV === 'development',
    ssl: sslOptions(env),
    extra: {
      max: 20, // connection pool max
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  };
}

export const databaseConfig = registerAs('database', () => dataSourceOptions());

// For the TypeORM CLI: `migration:run -d dist/config/database.config.js`
export default new DataSource(dataSourceOptions());
