import * as Joi from 'joi';
import { SETUP_KEY_MIN_LENGTH } from '../common/constants';

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
  S3_ENDPOINT: Joi.string().uri().allow('').optional(),
  // Optional. Without it a setup key is generated and printed while the server has no owner
  SETUP_KEY: Joi.string().min(SETUP_KEY_MIN_LENGTH).allow('').optional(),
});
