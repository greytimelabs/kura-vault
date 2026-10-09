// Started by Playwright before the tests: a throwaway Postgres in Docker, a fresh
// schema, then the real backend on its own port.
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB, DB_CONTAINER, backendEnv } from './env';

const backendDir = fileURLToPath(new URL('../../../backend', import.meta.url));
const env = { ...process.env, ...backendEnv };

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function containerRunning(): boolean {
  try {
    return docker('inspect', '-f', '{{.State.Running}}', DB_CONTAINER) === 'true';
  } catch {
    return false;
  }
}

async function waitForPostgres(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const client = new pg.Client({ ...DB, database: 'postgres' });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('Postgres did not become ready');
}

async function recreateDatabase(): Promise<void> {
  const client = new pg.Client({ ...DB, database: 'postgres' });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${DB.database} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${DB.database}`);
  await client.end();
}

if (!containerRunning()) {
  // Data lives in memory and the container removes itself when stopped
  docker(
    'run', '-d', '--rm',
    '--name', DB_CONTAINER,
    '-e', `POSTGRES_USER=${DB.user}`,
    '-e', `POSTGRES_PASSWORD=${DB.password}`,
    '-p', `127.0.0.1:${DB.port}:5432`,
    '--tmpfs', '/var/lib/postgresql',
    'postgres:18-alpine',
  );
}

await waitForPostgres();
await recreateDatabase();

execFileSync('pnpm', ['run', 'build'], { cwd: backendDir, env, stdio: 'inherit' });
execFileSync('pnpm', ['run', 'migration:run'], { cwd: backendDir, env, stdio: 'inherit' });

const server = spawn('node', ['dist/main.js'], { cwd: backendDir, env, stdio: 'inherit' });
const stop = () => server.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
