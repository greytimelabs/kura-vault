import { defineConfig, devices } from '@playwright/test';
import { API_PORT, API_URL, MULTI_WEB_PORT, MULTI_WEB_URL, WEB_PORT, WEB_URL } from './tests/e2e/env';

const firefoxServer = process.env.PW_FIREFOX_WS;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // Each browser runs the whole journey in order, the three browsers side by side
  fullyParallel: false,
  workers: 3,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
        // Playwright's Firefox build does not start on every macOS release. Set
        // PW_FIREFOX_WS to drive Firefox in the Playwright container instead
        // (see "e2e:firefox-server" in package.json); the app is still loaded from
        // this machine's localhost, which the browser reaches through the connection.
        ...(firefoxServer ? { connectOptions: { wsEndpoint: firefoxServer, exposeNetwork: '<loopback>' } } : {}),
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'tsx tests/e2e/start-backend.ts',
      url: `${API_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      // The production build, so the content security policy and the bundled
      // worker are what gets tested
      command: `vite build && vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
    {
      // The multi-server build: no proxy, it calls the API cross-origin like a hosted client.
      // Its policy must also let it reach the test API, which is plain http on this machine.
      command: `vite build --outDir dist-multi && vite preview --outDir dist-multi --port ${MULTI_WEB_PORT} --strictPort`,
      url: MULTI_WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        VITE_MULTI_SERVER: 'true',
        VITE_S3_ORIGIN: `https: http://localhost:${API_PORT} http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
