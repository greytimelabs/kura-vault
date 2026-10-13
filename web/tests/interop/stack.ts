// Everything the app needs to be run for real: a throwaway Postgres, the real
// backend, and a stand-in for the storage bucket that keeps blobs in memory.
// The mobile app's interop test (app/integration_test) runs against this, and
// web-side.ts reads and writes the same data with the web client's own crypto.
//
//   pnpm exec tsx tests/interop/stack.ts
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB, DB_CONTAINER, backendEnv } from '../e2e/env';
import { startMemoryStorage } from '../e2e/memoryStorage';
import { STORAGE_PORT } from './ports';


const backendDir = fileURLToPath(new URL('../../../backend', import.meta.url));
const env = { ...process.env, ...backendEnv, S3_ENDPOINT: `http://localhost:${STORAGE_PORT}` };

// ── Storage ──
startMemoryStorage(STORAGE_PORT);

// ── Database ──
const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let running = false;
try {
  running = docker('inspect', '-f', '{{.State.Running}}', DB_CONTAINER) === 'true';
} catch {
  // not there yet
}
if (!running) {
  docker(
    'run', '-d', '--rm', '--name', DB_CONTAINER,
    '-e', `POSTGRES_USER=${DB.user}`, '-e', `POSTGRES_PASSWORD=${DB.password}`,
    '-p', `127.0.0.1:${DB.port}:5432`, '--tmpfs', '/var/lib/postgresql', 'postgres:18-alpine',
  );
}
for (let attempt = 0; ; attempt++) {
  const client = new pg.Client({ ...DB, database: 'postgres' });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${DB.database} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${DB.database}`);
    await client.end();
    break;
  } catch (err) {
    if (attempt > 60) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// ── Backend ──
execFileSync('pnpm', ['run', 'build'], { cwd: backendDir, env, stdio: 'inherit' });
execFileSync('pnpm', ['run', 'migration:run'], { cwd: backendDir, env, stdio: 'inherit' });
const server = spawn('node', ['dist/main.js'], { cwd: backendDir, env, stdio: 'inherit' });
const stop = () => {
  server.kill('SIGTERM');
  try {
    docker('stop', DB_CONTAINER);
  } catch {
    // already gone
  }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('exit', (code) => process.exit(code ?? 0));
