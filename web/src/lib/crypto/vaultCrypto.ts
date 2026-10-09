import { IV_LENGTH, SALT_LENGTH, gcmDecrypt, gcmEncrypt, importAesKey, randomBytes, zero } from './aesgcm';
import { deriveKekBytes } from './argon2';
import { b64decode, b64encode, utf8Decode, utf8Encode, type Bytes } from './base64';

export interface VaultInfo {
  id: string;
  kekSalt: string;
  kekVerify: string;
  kekVerifyNonce: string;
  labelEncrypted: string | null;
  labelNonce: string | null;
}

export interface EncryptedText {
  encrypted: string;
  nonce: string;
}

const KEK_USAGES: KeyUsage[] = ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'];

/** Derive a vault's KEK as a non-extractable key; the raw bytes are zeroed before returning. */
export async function deriveKek(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const raw = await deriveKekBytes(passphrase, b64decode(saltB64));
  try {
    return await importAesKey(raw, KEK_USAGES);
  } finally {
    zero(raw);
  }
}

/** True when the KEK decrypts the vault's verification token back to the vault id. */
export async function verifyKek(kek: CryptoKey, vault: VaultInfo): Promise<boolean> {
  try {
    const plain = await gcmDecrypt(kek, b64decode(vault.kekVerifyNonce), b64decode(vault.kekVerify));
    return utf8Decode(plain) === vault.id;
  } catch {
    return false;
  }
}

export async function encryptText(key: CryptoKey, text: string): Promise<EncryptedText> {
  const iv = randomBytes(IV_LENGTH);
  const encrypted = await gcmEncrypt(key, iv, utf8Encode(text));
  return { encrypted: b64encode(encrypted), nonce: b64encode(iv) };
}

/** Null when there is nothing to decrypt or the ciphertext does not verify. */
export async function decryptText(
  key: CryptoKey,
  encrypted: string | null | undefined,
  nonce: string | null | undefined,
): Promise<string | null> {
  if (!encrypted || !nonce) return null;
  try {
    return utf8Decode(await gcmDecrypt(key, b64decode(nonce), b64decode(encrypted)));
  } catch {
    return null;
  }
}

/** Unwrap a media DEK without ever exposing its bytes to script. */
export function unwrapDek(kek: CryptoKey, encryptedDek: string, dekNonce: string): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    b64decode(encryptedDek),
    kek,
    { name: 'AES-GCM', iv: b64decode(dekNonce) },
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
}

export interface NewDek {
  key: CryptoKey;
  encryptedDek: string;
  dekNonce: string;
}

/** Fresh random DEK for an upload, wrapped under the vault KEK. */
export async function generateWrappedDek(kek: CryptoKey): Promise<NewDek> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const nonce = randomBytes(IV_LENGTH);
  const wrapped = await crypto.subtle.wrapKey('raw', key, kek, { name: 'AES-GCM', iv: nonce });
  return { key, encryptedDek: b64encode(new Uint8Array(wrapped)), dekNonce: b64encode(nonce) };
}

export interface NewVaultMaterial extends VaultInfo {
  kek: CryptoKey;
}

/**
 * Everything POST /vaults needs for a new vault. The id is generated here because
 * the verification token is the id encrypted under the KEK.
 */
export async function createVaultMaterial(passphrase: string, label: string): Promise<NewVaultMaterial> {
  const id = crypto.randomUUID();
  const salt = randomBytes(SALT_LENGTH);
  const kekSalt = b64encode(salt);
  const kek = await deriveKek(passphrase, kekSalt);
  const verify = await encryptText(kek, id);
  const trimmed = label.trim();
  const encLabel = trimmed ? await encryptText(kek, trimmed) : null;
  return {
    id,
    kekSalt,
    kekVerify: verify.encrypted,
    kekVerifyNonce: verify.nonce,
    labelEncrypted: encLabel?.encrypted ?? null,
    labelNonce: encLabel?.nonce ?? null,
    kek,
  };
}

export type { Bytes };
