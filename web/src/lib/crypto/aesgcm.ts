import type { Bytes } from './base64';

// Wire format shared with the Flutter app and the migration CLI:
// AES-256-GCM, 12-byte IV, output = ciphertext followed by the 16-byte tag.
// Every encryption binds the ids it belongs to as additional data (see aad.ts).
export const IV_LENGTH = 12;
export const KEY_LENGTH = 32;
export const SALT_LENGTH = 16;
const TAG_BITS = 128;

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function importAesKey(
  raw: Bytes,
  usages: KeyUsage[],
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, usages);
}

export function gcmParams(iv: Bytes, aad?: Bytes): AesGcmParams {
  return { name: 'AES-GCM', iv, tagLength: TAG_BITS, ...(aad ? { additionalData: aad } : {}) };
}

export async function gcmEncrypt(key: CryptoKey, iv: Bytes, plaintext: BufferSource, aad?: Bytes): Promise<Bytes> {
  const out = await crypto.subtle.encrypt(gcmParams(iv, aad), key, plaintext);
  return new Uint8Array(out);
}

/** Rejects when the tag does not verify (wrong key, wrong additional data or tampered data). */
export async function gcmDecrypt(key: CryptoKey, iv: Bytes, ciphertext: BufferSource, aad?: Bytes): Promise<Bytes> {
  const out = await crypto.subtle.decrypt(gcmParams(iv, aad), key, ciphertext);
  return new Uint8Array(out);
}

export function zero(bytes: Uint8Array): void {
  bytes.fill(0);
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
