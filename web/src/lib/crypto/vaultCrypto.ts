import { IV_LENGTH, KEY_LENGTH, SALT_LENGTH, concat, gcmDecrypt, gcmEncrypt, gcmParams, importAesKey, randomBytes, zero } from './aesgcm';
import { aad } from './aad';
import { deriveKekBytes } from './argon2';
import { b64decode, b64encode, utf8Decode, utf8Encode, type Bytes } from './base64';
import { open, seal } from './identity';

export interface EncryptedText {
  encrypted: string;
  nonce: string;
}

/** A key wrapped under another AES key. */
export interface WrappedKey {
  wrapped: string;
  nonce: string;
}

/**
 * Vault and album keys encrypt names and wrap the keys beneath them. They are
 * extractable so the holder can re-wrap them for someone they share with; the
 * worker never passes the key object or its bytes to the page.
 */
const SCOPE_KEY_USAGES: KeyUsage[] = ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'];

/** Key from a passphrase (master or vault). Non-extractable; the raw bytes are zeroed before returning. */
export async function derivePassphraseKey(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const raw = await deriveKekBytes(passphrase, b64decode(saltB64));
  try {
    return await importAesKey(raw, ['encrypt', 'decrypt']);
  } finally {
    zero(raw);
  }
}

export function newSalt(): string {
  return b64encode(randomBytes(SALT_LENGTH));
}

export function importScopeKey(raw: Bytes): Promise<CryptoKey> {
  return importAesKey(raw, SCOPE_KEY_USAGES, true);
}

export function generateScopeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_LENGTH * 8 }, true, SCOPE_KEY_USAGES);
}

async function exportRaw(key: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

export async function encryptText(key: CryptoKey, text: string, additional: Bytes): Promise<EncryptedText> {
  const iv = randomBytes(IV_LENGTH);
  const encrypted = await gcmEncrypt(key, iv, utf8Encode(text), additional);
  return { encrypted: b64encode(encrypted), nonce: b64encode(iv) };
}

/** Null when there is nothing to decrypt or the ciphertext does not verify. */
export async function decryptText(
  key: CryptoKey,
  encrypted: string | null | undefined,
  nonce: string | null | undefined,
  additional: Bytes,
): Promise<string | null> {
  if (!encrypted || !nonce) return null;
  try {
    return utf8Decode(await gcmDecrypt(key, b64decode(nonce), b64decode(encrypted), additional));
  } catch {
    return null;
  }
}

/** Wrap `key` under `wrapping` without exposing its bytes to script. */
export async function wrapKey(wrapping: CryptoKey, key: CryptoKey, additional: Bytes): Promise<WrappedKey> {
  const nonce = randomBytes(IV_LENGTH);
  const wrapped = await crypto.subtle.wrapKey('raw', key, wrapping, gcmParams(nonce, additional));
  return { wrapped: b64encode(new Uint8Array(wrapped)), nonce: b64encode(nonce) };
}

/** Rejects when the wrapping key or the additional data is not the one it was wrapped with. */
export function unwrapKey(
  wrapping: CryptoKey,
  wrapped: WrappedKey,
  additional: Bytes,
  usages: KeyUsage[],
  extractable: boolean,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    b64decode(wrapped.wrapped),
    wrapping,
    gcmParams(b64decode(wrapped.nonce), additional),
    { name: 'AES-GCM' },
    extractable,
    usages,
  );
}

export const unwrapScopeKey = (wrapping: CryptoKey, wrapped: WrappedKey, additional: Bytes) =>
  unwrapKey(wrapping, wrapped, additional, SCOPE_KEY_USAGES, true);

/** Seal a vault or album key to a user's public key. */
export async function sealScopeKey(key: CryptoKey, recipientPk: Bytes, additional: Bytes): Promise<Bytes> {
  const raw = await exportRaw(key);
  try {
    return await seal(recipientPk, raw, additional);
  } finally {
    zero(raw);
  }
}

export async function openScopeKey(
  encPrivate: CryptoKey,
  myPk: Bytes,
  sealed: Bytes,
  additional: Bytes,
): Promise<CryptoKey> {
  const raw = await open(encPrivate, myPk, sealed, additional);
  try {
    if (raw.length !== KEY_LENGTH) throw new Error('Invalid key');
    return await importScopeKey(raw);
  } finally {
    zero(raw);
  }
}

export interface CreatorGrant {
  /** base64 of Seal(creator's public key, iv ‖ AES-GCM(passphrase key, vault key)). */
  wrappedKey: string;
  kdfSalt: string;
}

/**
 * A creator's own copy of a vault key has two layers: the vault passphrase
 * inside, their public key outside. Either secret alone opens nothing.
 */
export async function wrapCreatorGrant(
  vaultKey: CryptoKey,
  passphrase: string,
  vaultId: string,
  userId: string,
  encPk: Bytes,
): Promise<CreatorGrant> {
  const kdfSalt = newSalt();
  const passphraseKey = await derivePassphraseKey(passphrase, kdfSalt);
  const raw = await exportRaw(vaultKey);
  try {
    const iv = randomBytes(IV_LENGTH);
    const inner = concat(iv, await gcmEncrypt(passphraseKey, iv, raw, aad.vaultKeyPassphrase(vaultId, userId)));
    const sealed = await seal(encPk, inner, aad.vaultKey(vaultId, userId));
    return { wrappedKey: b64encode(sealed), kdfSalt };
  } finally {
    zero(raw);
  }
}

/** Remove the public-key layer. What is left still needs the vault passphrase. */
export function openCreatorGrantOuter(
  encPrivate: CryptoKey,
  encPk: Bytes,
  grant: CreatorGrant,
  vaultId: string,
  userId: string,
): Promise<Bytes> {
  return open(encPrivate, encPk, b64decode(grant.wrappedKey), aad.vaultKey(vaultId, userId));
}

/** Null when the passphrase is not this vault's. */
export async function openCreatorGrantInner(
  inner: Bytes,
  passphrase: string,
  kdfSalt: string,
  vaultId: string,
  userId: string,
): Promise<CryptoKey | null> {
  let passphraseKey: CryptoKey;
  try {
    passphraseKey = await derivePassphraseKey(passphrase, kdfSalt);
  } catch {
    return null; // malformed salt: this vault can never match
  }
  let raw: Bytes;
  try {
    raw = await gcmDecrypt(
      passphraseKey,
      inner.slice(0, IV_LENGTH),
      inner.slice(IV_LENGTH),
      aad.vaultKeyPassphrase(vaultId, userId),
    );
  } catch {
    return null;
  }
  try {
    return raw.length === KEY_LENGTH ? await importScopeKey(raw) : null;
  } finally {
    zero(raw);
  }
}

/** Fresh random key for one upload. Extractable only so it can be wrapped. */
export function generateMediaKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_LENGTH * 8 }, true, ['encrypt', 'decrypt']);
}

export type { Bytes };
