import type { Bytes } from './base64';

// Wire format shared with the Flutter app and the migration CLI:
// AES-256-GCM, 12-byte IV, no AAD, output = ciphertext followed by the 16-byte tag.
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

export async function gcmEncrypt(key: CryptoKey, iv: Bytes, plaintext: BufferSource): Promise<Bytes> {
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: TAG_BITS }, key, plaintext);
  return new Uint8Array(out);
}

/** Rejects when the tag does not verify (wrong key or tampered data). */
export async function gcmDecrypt(key: CryptoKey, iv: Bytes, ciphertext: BufferSource): Promise<Bytes> {
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: TAG_BITS }, key, ciphertext);
  return new Uint8Array(out);
}

export function zero(bytes: Uint8Array): void {
  bytes.fill(0);
}
