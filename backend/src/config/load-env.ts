import { readFileSync } from 'fs';
import { config } from 'dotenv';

/**
 * Secrets that may be given as a file instead, the way the official Postgres image
 * does it: `JWT_SECRET_FILE=/run/secrets/jwt` puts that file's contents in
 * `JWT_SECRET`. Lets Docker, Swarm and Kubernetes secrets stay out of the environment.
 */
export const FILE_SECRETS = [
  'JWT_SECRET',
  'POSTGRES_PASSWORD',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'SETUP_KEY',
] as const;

export function loadSecretFiles(env: NodeJS.ProcessEnv): void {
  for (const name of FILE_SECRETS) {
    const path = env[`${name}_FILE`];
    if (!path) continue;
    if (env[name]) {
      throw new Error(`Set either ${name} or ${name}_FILE, not both`);
    }
    let value: string;
    try {
      value = readFileSync(path, 'utf8');
    } catch {
      throw new Error(`${name}_FILE points at ${path}, which cannot be read`);
    }
    // Editors and `echo` add a final newline; nothing else is trimmed
    env[name] = value.replace(/\r?\n$/, '');
    delete env[`${name}_FILE`];
  }
}

// Runs once, before any configuration is read: imported first by main.ts and by
// the TypeORM CLI data source. Values already in the environment win over .env.
config({ quiet: true });
loadSecretFiles(process.env);
