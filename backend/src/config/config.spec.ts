import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadSecretFiles } from './load-env';
import { corsOriginsOf, trustProxyOf } from './app.config';
import { dataSourceOptions } from './database.config';
import { envValidationSchema } from './validation';

const base = {
  POSTGRES_HOST: 'db',
  POSTGRES_USER: 'kv',
  POSTGRES_PASSWORD: 'pw',
  POSTGRES_DB: 'kv',
  JWT_SECRET: 'x'.repeat(64),
  AWS_ACCESS_KEY_ID: 'key',
  AWS_SECRET_ACCESS_KEY: 'secret',
};
const validate = (env: Record<string, string>) => envValidationSchema.validate({ ...base, ...env });

describe('environment validation', () => {
  it('treats an unset NODE_ENV as a deployed server, which needs PUBLIC_URL', () => {
    const { error, value } = validate({});
    expect(value.NODE_ENV).toBe('production');
    expect(error?.message).toContain('PUBLIC_URL');
  });

  it('accepts an https PUBLIC_URL', () => {
    expect(validate({ PUBLIC_URL: 'https://vault.example.com' }).error).toBeUndefined();
  });

  it('refuses plain http except on this machine', () => {
    expect(validate({ PUBLIC_URL: 'http://vault.example.com' }).error?.message).toContain('https://');
    expect(validate({ PUBLIC_URL: 'http://192.168.1.10:8080' }).error?.message).toContain('https://');
    expect(validate({ PUBLIC_URL: 'http://localhost:8080' }).error).toBeUndefined();
  });

  it('refuses a PUBLIC_URL with a path', () => {
    expect(validate({ PUBLIC_URL: 'https://example.com/vault' }).error?.message).toContain('origin only');
  });

  it('needs no PUBLIC_URL in development', () => {
    expect(validate({ NODE_ENV: 'development' }).error).toBeUndefined();
  });

  it('refuses TRUST_PROXY=true, which would believe any client', () => {
    expect(validate({ NODE_ENV: 'development', TRUST_PROXY: 'true' }).error?.message).toContain('hop count');
  });

  it('requires storage credentials', () => {
    const { AWS_SECRET_ACCESS_KEY: _, ...rest } = base;
    const { error } = envValidationSchema.validate({ ...rest, NODE_ENV: 'development' });
    expect(error?.message).toContain('AWS_SECRET_ACCESS_KEY');
  });
});

describe('trustProxyOf', () => {
  it.each([
    [undefined, false],
    ['false', false],
    ['1', 1],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('%s -> %s', (input, expected) => {
    expect(trustProxyOf(input)).toEqual(expected);
  });
});

describe('corsOriginsOf', () => {
  it('always allows the server itself', () => {
    expect(corsOriginsOf('https://web.example.app', 'https://vault.example.com')).toEqual([
      'https://vault.example.com',
      'https://web.example.app',
    ]);
    expect(corsOriginsOf('', 'https://vault.example.com')).toEqual(['https://vault.example.com']);
  });

  it('keeps the old default for development', () => {
    expect(corsOriginsOf(undefined, undefined)).toEqual(['http://localhost:3000']);
  });
});

describe('database TLS', () => {
  it('is off unless asked for, whatever NODE_ENV says', () => {
    expect(dataSourceOptions({ NODE_ENV: 'production' }).ssl).toBe(false);
  });

  it('verifies the certificate with verify-full', () => {
    expect(dataSourceOptions({ POSTGRES_SSL: 'verify-full' }).ssl).toEqual({ rejectUnauthorized: true });
  });

  it('runs migrations at start only when enabled', () => {
    expect(dataSourceOptions({}).migrationsRun).toBe(false);
    expect(dataSourceOptions({ MIGRATIONS_RUN: 'true' }).migrationsRun).toBe(true);
  });
});

describe('loadSecretFiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kv-secrets-'));
  const file = join(dir, 'jwt');
  writeFileSync(file, 'from-a-file\n');

  it('reads NAME_FILE into NAME, dropping the final newline', () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_FILE: file };
    loadSecretFiles(env);
    expect(env.JWT_SECRET).toBe('from-a-file');
    expect(env.JWT_SECRET_FILE).toBeUndefined();
  });

  it('refuses both forms at once', () => {
    expect(() => loadSecretFiles({ JWT_SECRET: 'a', JWT_SECRET_FILE: file })).toThrow('not both');
  });

  it('names the file it cannot read', () => {
    expect(() => loadSecretFiles({ SETUP_KEY_FILE: join(dir, 'missing') })).toThrow('SETUP_KEY_FILE');
  });
});
