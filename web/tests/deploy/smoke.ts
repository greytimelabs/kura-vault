// Checks a deployed stack (deploy/docker-compose.yml) end to end through its public
// address, the way a browser uses it: owner setup, a vault, an upload to the
// pre-signed URLs, the download, and the delete erasing the file from storage.
//
//   E2E_API_URL=https://vault.example.com/api/v1 SETUP_KEY=... pnpm exec tsx tests/deploy/smoke.ts
//
// Needs a server with no owner yet. Set SMOKE_SAME_ORIGIN=false for external storage,
// where the URLs point at the bucket instead of the server.
import assert from 'node:assert/strict';
import { ApiUser } from '../e2e/apiUser';
import { API_URL } from '../e2e/env';

const origin = new URL(API_URL).origin;
const setupKey = process.env.SETUP_KEY;
if (!process.env.E2E_API_URL || !setupKey) throw new Error('Set E2E_API_URL and SETUP_KEY');
const sameOrigin = process.env.SMOKE_SAME_ORIGIN !== 'false';

const step = (text: string) => console.log(`- ${text}`);
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

const health = (await (await fetch(`${API_URL}/health`)).json()) as { data: { setupRequired: boolean; version: string } };
assert.equal(health.data.setupRequired, true, 'the server already has an owner');
step(`server ${health.data.version} is waiting for setup`);

const owner = await ApiUser.setup(setupKey, {
  username: 'smoke-owner',
  password: `Smoke-${crypto.randomUUID()}`,
  passphrase: `smoke master passphrase ${crypto.randomUUID()}`,
});
step('owner created and signed in');

const vaultPassphrase = `smoke vault ${crypto.randomUUID()}`;
const vaultId = await owner.createVault(vaultPassphrase, 'Smoke');
step('vault created');

const { mediaId, uploadUrls } = await owner.call<{
  mediaId: string;
  uploadUrls: { thumb: string; preview: string; original: string };
}>('POST', '/media/upload/init', { vaultId, mediaType: 'photo' });
for (const url of Object.values(uploadUrls)) {
  if (sameOrigin) assert.ok(url.startsWith(`${origin}/`), `upload URL is not on ${origin}: ${url}`);
}

const encrypted = await owner.keyring.encryptMedia({
  mediaId,
  vaultId,
  thumb: bytes('smoke thumb'),
  preview: bytes('smoke preview'),
  original: bytes(`smoke original ${'x'.repeat(256 * 1024)}`),
  meta: { filename: 'smoke.jpg' },
});
for (const tier of ['thumb', 'preview', 'original'] as const) {
  const response = await fetch(uploadUrls[tier], {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encrypted[tier].data,
  });
  assert.equal(response.status, 200, `${tier} upload: ${response.status} ${await response.text()}`);
}
step('three encrypted files uploaded to their pre-signed URLs');

await owner.call('POST', '/media/upload/complete', {
  mediaId,
  vaultId,
  mediaType: 'photo',
  capturedAt: new Date().toISOString(),
  keyWrappedVault: encrypted.vaultKey!.wrapped,
  keyNonceVault: encrypted.vaultKey!.nonce,
  thumbIv: encrypted.thumb.iv,
  previewIv: encrypted.preview.iv,
  originalIv: encrypted.original.iv,
  encryptedMeta: encrypted.encryptedMeta,
  metaNonce: encrypted.metaNonce,
});

const { originalUrl } = await owner.call<{ originalUrl: string }>('GET', `/media/${mediaId}/urls`);
const download = await fetch(originalUrl);
assert.equal(download.status, 200, `download: ${download.status}`);
assert.deepEqual(new Uint8Array(await download.arrayBuffer()), new Uint8Array(encrypted.original.data));
step('original downloaded, byte for byte what was uploaded');

const [row] = await owner.listMedia({ vaultId });
assert.deepEqual(await owner.filenames([row]), ['smoke.jpg']);
step('file name decrypts');

await owner.call('POST', '/media/delete', { ids: [mediaId] });
let gone = false;
for (let attempt = 0; attempt < 20 && !gone; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  gone = (await fetch(originalUrl)).status === 404;
}
assert.ok(gone, 'the deleted original is still in storage');
step('deleted, and the file is gone from storage');

console.log('smoke test passed');
