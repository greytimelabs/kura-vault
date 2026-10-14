import * as Joi from 'joi';
import { SETUP_KEY_MIN_LENGTH } from '../common/constants';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The address users reach this server at. Browsers only expose WebCrypto on https
 * pages, so anything else is refused, apart from this machine for development.
 */
const publicUrl = Joi.string()
  .uri({ scheme: ['http', 'https'] })
  .custom((value: string, helpers) => {
    const url = new URL(value);
    if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
      return helpers.message({ custom: 'PUBLIC_URL must be an origin only, such as https://vault.example.com' });
    }
    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
      return helpers.message({
        custom: 'PUBLIC_URL must use https://. Browsers only allow the encryption the web client needs on secure pages',
      });
    }
    return value;
  });

/** A hop count or a list of addresses. `true` would trust a client-supplied X-Forwarded-For. */
const trustProxy = Joi.string()
  .custom((value: string, helpers) =>
    value === 'true'
      ? helpers.message({ custom: 'TRUST_PROXY=true lets any client forge its address; set a hop count such as 1' })
      : value,
  );

export const envValidationSchema = Joi.object({
  // Names the run environment. Unset means a deployed server, so a forgotten value fails safe
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('production'),
  PORT: Joi.number().port().default(3000),
  APP_VERSION: Joi.string().optional(),

  PUBLIC_URL: publicUrl.when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.optional() }),
  CORS_ORIGINS: Joi.string().allow('').optional(),
  TRUST_PROXY: trustProxy.default('false'),
  HSTS_MAX_AGE: Joi.number().integer().min(0).default(31536000),
  HSTS_INCLUDE_SUBDOMAINS: Joi.boolean().default(false),

  POSTGRES_HOST: Joi.string().required(),
  POSTGRES_PORT: Joi.number().port().default(5432),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_SSL: Joi.string().valid('disable', 'require', 'verify-full').default('disable'),
  POSTGRES_SSL_CA_FILE: Joi.string().optional(),
  MIGRATIONS_RUN: Joi.boolean().default(false),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  // bcrypt accepts 4-31; 12 is the default, the tests use 4 for speed
  HASH_SALT_ROUNDS: Joi.number().integer().min(4).max(16).default(12),

  AWS_REGION: Joi.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: Joi.string().required(),
  AWS_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_BUCKET_NAME: Joi.string().default('kura-vault-storage'),
  S3_ENDPOINT: Joi.string().uri().allow('').optional(),
  // Where browsers reach the bucket, when that differs from S3_ENDPOINT (a bucket behind this server's own address)
  S3_PUBLIC_ENDPOINT: Joi.string().uri().allow('').optional(),

  THROTTLE_TTL: Joi.number().integer().min(1).default(60),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),

  // Optional. Without it a setup key is generated and printed while the server has no owner
  SETUP_KEY: Joi.string().min(SETUP_KEY_MIN_LENGTH).allow('').optional(),
});
