import { defineConfig } from '@playwright/test';
import { API_STORAGE_PORT, API_URL } from './tests/e2e/env';

// The server's rules tested without a browser: a real backend and database,
// driven by the same key-handling code the web client runs. Fast, and the place
// for anything adversarial (tampered rows, forged shares, revoked access).
export default defineConfig({
  testDir: './tests/api',
  testMatch: '**/*.spec.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  webServer: [
    {
      command: 'tsx tests/e2e/start-backend.ts',
      // Deleting erases files, so this suite gives the server a storage it can reach
      env: { E2E_S3_ENDPOINT: `http://127.0.0.1:${API_STORAGE_PORT}` },
      url: `${API_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
