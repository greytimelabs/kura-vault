import { execFileSync } from 'node:child_process';
import { DB_CONTAINER } from './env';

export default function globalTeardown(): void {
  try {
    execFileSync('docker', ['stop', DB_CONTAINER], { stdio: 'ignore' });
  } catch {
    // already gone
  }
}
