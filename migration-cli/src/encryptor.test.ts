import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCipheriv } from 'node:crypto';
import { decryptBlob, deriveKek, verifyKek } from './encryptor';

// Shared with the web client and the Flutter app; see web/scripts/gen-vectors.ts
const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'crypto-vectors.json'), 'utf-8'),
);

test('Argon2id KEK derivation matches the shared vectors', async () => {
  for (const v of vectors.kdf) {
    const kek = await deriveKek(v.passphrase, Buffer.from(v.salt, 'base64'));
    assert.equal(kek.toString('hex'), v.kek, `passphrase ${v.passphrase}`);
  }
});

test('AES-256-GCM layout matches the shared vectors', () => {
  for (const v of vectors.gcm) {
    const key = Buffer.from(v.key, 'hex');
    const iv = Buffer.from(v.iv, 'base64');
    const plaintext = Buffer.from(v.plaintext, 'base64');

    // encryptBlob picks a random IV, so rebuild its layout with the vector's IV
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    assert.equal(encrypted.toString('base64'), v.ciphertext);

    assert.deepEqual(decryptBlob(Buffer.from(v.ciphertext, 'base64'), key, iv), plaintext);
  }
});

test('the vault passphrase verifies and a wrong one does not', async () => {
  const { vault } = vectors;
  const salt = Buffer.from(vault.kekSalt, 'base64');

  assert.equal(verifyKek(await deriveKek(vault.passphrase, salt), vault), true);
  assert.equal(verifyKek(await deriveKek(`${vault.passphrase}x`, salt), vault), false);
});
