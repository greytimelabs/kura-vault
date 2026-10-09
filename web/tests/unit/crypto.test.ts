import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gcmDecrypt, gcmEncrypt, importAesKey, randomBytes } from '../../src/lib/crypto/aesgcm';
import { deriveKekBytes } from '../../src/lib/crypto/argon2';
import { b64decode, b64encode, hexDecode, hexEncode, utf8Decode, utf8Encode } from '../../src/lib/crypto/base64';
import {
  createVaultMaterial,
  decryptText,
  deriveKek,
  encryptText,
  generateWrappedDek,
  unwrapDek,
  verifyKek,
} from '../../src/lib/crypto/vaultCrypto';
// The migration CLI's own encryption code, to prove its uploads open in the browser
import * as cli from '../../../migration-cli/src/encryptor';

// The same file the Flutter app and the CLI are tested against
const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../crypto-vectors.json', import.meta.url)), 'utf-8'),
);

describe('shared interop vectors', () => {
  it('derives the same KEK for every passphrase', async () => {
    for (const v of vectors.kdf) {
      const kek = await deriveKekBytes(v.passphrase, b64decode(v.salt));
      expect(hexEncode(kek), v.passphrase).toBe(v.kek);
    }
  });

  it('produces and reads the same AES-GCM bytes', async () => {
    for (const v of vectors.gcm) {
      const key = await importAesKey(hexDecode(v.key), ['encrypt', 'decrypt']);
      const iv = b64decode(v.iv);
      expect(b64encode(await gcmEncrypt(key, iv, b64decode(v.plaintext)))).toBe(v.ciphertext);
      expect(b64encode(await gcmDecrypt(key, iv, b64decode(v.ciphertext)))).toBe(v.plaintext);
    }
  });

  it('opens the vault, its label, a thumbnail and the metadata', async () => {
    const { vault, media } = vectors;
    const kek = await deriveKek(vault.passphrase, vault.kekSalt);

    expect(await verifyKek(kek, vault)).toBe(true);
    expect(await decryptText(kek, vault.labelEncrypted, vault.labelNonce)).toBe(vault.label);

    const dek = await unwrapDek(kek, media.encryptedDek, media.dekNonce);
    const thumb = await gcmDecrypt(dek, b64decode(media.thumbIv), b64decode(media.thumbCiphertext));
    expect(b64encode(thumb)).toBe(media.thumbPlaintext);

    expect(await decryptText(kek, media.encryptedMeta, media.metaNonce)).toBe(media.meta);
  });
});

describe('vault keys', () => {
  it('rejects a wrong passphrase', async () => {
    const { vault } = vectors;
    const wrong = await deriveKek(`${vault.passphrase}x`, vault.kekSalt);
    expect(await verifyKek(wrong, vault)).toBe(false);
    expect(await decryptText(wrong, vault.labelEncrypted, vault.labelNonce)).toBeNull();
  });

  it('a verified KEK for one vault does not verify another vault with the same passphrase', async () => {
    const a = await createVaultMaterial('shared passphrase', 'A');
    const b = await createVaultMaterial('shared passphrase', 'B');
    expect(a.kekSalt).not.toBe(b.kekSalt);
    expect(await verifyKek(a.kek, a)).toBe(true);
    expect(await verifyKek(a.kek, b)).toBe(false);
  });

  it('never hands out the KEK bytes', async () => {
    const kek = await deriveKek('passphrase', b64encode(randomBytes(16)));
    expect(kek.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', kek)).rejects.toThrow();
  });

  it('creates a vault that a fresh derivation can open', async () => {
    const created = await createVaultMaterial('a brand new passphrase', '  Holidays  ');
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b64decode(created.kekSalt)).toHaveLength(16);

    const kek = await deriveKek('a brand new passphrase', created.kekSalt);
    expect(await verifyKek(kek, created)).toBe(true);
    expect(await decryptText(kek, created.labelEncrypted, created.labelNonce)).toBe('Holidays');
  });

  it('leaves the label out when none is given', async () => {
    const created = await createVaultMaterial('another passphrase here', '   ');
    expect(created.labelEncrypted).toBeNull();
    expect(created.labelNonce).toBeNull();
  });
});

describe('media keys', () => {
  it('wraps a fresh DEK that only the KEK can unwrap', async () => {
    const kek = await deriveKek('upload passphrase', b64encode(randomBytes(16)));
    const other = await deriveKek('someone else', b64encode(randomBytes(16)));
    const dek = await generateWrappedDek(kek);

    const iv = randomBytes(12);
    const plaintext = randomBytes(5000);
    const ciphertext = await gcmEncrypt(dek.key, iv, plaintext);
    expect(ciphertext).toHaveLength(plaintext.length + 16);

    const unwrapped = await unwrapDek(kek, dek.encryptedDek, dek.dekNonce);
    expect(unwrapped.extractable).toBe(false);
    expect(await gcmDecrypt(unwrapped, iv, ciphertext)).toEqual(plaintext);

    await expect(unwrapDek(other, dek.encryptedDek, dek.dekNonce)).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const key = await importAesKey(randomBytes(32), ['encrypt', 'decrypt']);
    const iv = randomBytes(12);
    const ciphertext = await gcmEncrypt(key, iv, utf8Encode('untouched'));
    ciphertext[0]! ^= 1;
    await expect(gcmDecrypt(key, iv, ciphertext)).rejects.toThrow();
  });

  it('round-trips text with a new nonce each time', async () => {
    const key = await importAesKey(randomBytes(32), ['encrypt', 'decrypt']);
    const first = await encryptText(key, 'Summer 2024 ☀️');
    const second = await encryptText(key, 'Summer 2024 ☀️');
    expect(first.nonce).not.toBe(second.nonce);
    expect(await decryptText(key, first.encrypted, first.nonce)).toBe('Summer 2024 ☀️');
  });
});

describe('migration CLI compatibility', () => {
  it('reads media encrypted by the CLI', async () => {
    const { vault } = vectors;
    const cliKek = await cli.deriveKek(vault.passphrase, Buffer.from(vault.kekSalt, 'base64'));
    expect(cli.verifyKek(cliKek, vault)).toBe(true);

    const photo = Buffer.from(randomBytes(4096));
    const cliDek = cli.generateDek();
    const blob = cli.encryptBlob(photo, cliDek);
    const wrapped = cli.wrapDek(cliDek, cliKek);
    const meta = cli.encryptMeta({ filename: 'from-cli.jpg' }, cliKek);

    const kek = await deriveKek(vault.passphrase, vault.kekSalt);
    const dek = await unwrapDek(kek, wrapped.encryptedDek.toString('base64'), wrapped.nonce.toString('base64'));
    const plain = await gcmDecrypt(dek, new Uint8Array(blob.iv), new Uint8Array(blob.encrypted));
    expect(Buffer.from(plain).equals(photo)).toBe(true);

    const metaJson = await decryptText(kek, meta.encrypted, meta.nonce);
    expect(JSON.parse(metaJson!)).toEqual({ filename: 'from-cli.jpg' });
  });

  it('writes vaults the CLI accepts', async () => {
    const created = await createVaultMaterial('made in the browser', 'Web');
    const cliKek = await cli.deriveKek('made in the browser', Buffer.from(created.kekSalt, 'base64'));
    expect(cli.verifyKek(cliKek, created)).toBe(true);
    expect(utf8Decode(cli.decryptBlob(
      Buffer.from(created.labelEncrypted!, 'base64'),
      cliKek,
      Buffer.from(created.labelNonce!, 'base64'),
    ))).toBe('Web');
  });
});
