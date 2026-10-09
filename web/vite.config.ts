import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Where encrypted blobs are fetched from. Narrow this to the bucket's exact origin in production
// (for Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com).
// The multi-server build (VITE_MULTI_SERVER=true, see src/lib/config.ts) talks to servers and
// buckets it cannot know in advance, so there the default is any https origin.
const multiServer = process.env.VITE_MULTI_SERVER === 'true';
const s3Origin = process.env.VITE_S3_ORIGIN ?? (multiServer ? 'https:' : 'https://*.amazonaws.com');

export const contentSecurityPolicy = [
  "default-src 'none'",
  // 'wasm-unsafe-eval' is for the Argon2id WebAssembly module; no other eval is allowed
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  'media-src blob:',
  `connect-src 'self' ${s3Origin}`,
  "worker-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** Bake the policy into the built page so it holds on any static host. Dev needs HMR, so it is build-only. */
function cspMeta(): Plugin {
  return {
    name: 'kura-vault-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cspMeta()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // Same-origin API in dev, so the refresh cookie behaves exactly as in production
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
