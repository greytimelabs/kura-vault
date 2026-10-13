// Everything the end-to-end run needs, in one place. None of it touches the
// development database, the development backend or real storage.
export const WEB_PORT = 5273;
export const API_PORT = 3100;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
// A second build of the client in multi-server mode, served apart from the API
export const MULTI_WEB_PORT = 5274;
export const MULTI_WEB_URL = `http://localhost:${MULTI_WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/api/v1`;

export const DB_CONTAINER = 'kuravault-e2e-db';
export const DB = {
  host: 'localhost',
  port: 5544,
  user: 'mv_e2e',
  password: 'mv_e2e',
  database: 'kuravault_e2e',
};

export const S3_BUCKET = 'kura-vault-e2e';
/** Where the API suite's storage stand-in listens. */
export const API_STORAGE_PORT = 9178;
export const S3_REGION = 'ap-south-1';

/** What the server would otherwise generate and print at first start. */
export const SETUP_KEY = 'e2e-setup-key-0123456789abcdef0123456789';

export const OWNER = {
  username: 'e2e-owner',
  password: 'Owner-Passw0rd!-e2e',
  passphrase: 'owner master passphrase for e2e',
};

/** Environment for the backend instance the tests run against. */
export const backendEnv: Record<string, string> = {
  // 'test' keeps SQL logging off; cookies are non-Secure outside production either way
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  POSTGRES_HOST: DB.host,
  POSTGRES_PORT: String(DB.port),
  POSTGRES_USER: DB.user,
  POSTGRES_PASSWORD: DB.password,
  POSTGRES_DB: DB.database,
  JWT_SECRET: 'e2e-only-jwt-secret-not-used-anywhere-else-0123456789abcdef0123456789',
  JWT_EXPIRATION: '15m',
  JWT_REFRESH_EXPIRATION: '7d',
  // Signing a URL needs no network, so made-up credentials are enough: every
  // request to the storage host is answered by the test's in-memory stand-in
  AWS_REGION: S3_REGION,
  AWS_ACCESS_KEY_ID: 'e2e-access-key',
  AWS_SECRET_ACCESS_KEY: 'e2e-secret-key',
  S3_BUCKET_NAME: S3_BUCKET,
  // Empty by default on purpose: stops backend/.env from pointing the run at a real
  // R2 endpoint. The API suite points it at its in-memory stand-in instead.
  S3_ENDPOINT: process.env.E2E_S3_ENDPOINT ?? '',
  CORS_ORIGINS: `${WEB_URL},${MULTI_WEB_URL}`,
  // The suite drives three browsers at once from one address
  THROTTLE_TTL: '60',
  THROTTLE_LIMIT: '100000',
  HASH_SALT_ROUNDS: '4',
  SETUP_KEY,
};
