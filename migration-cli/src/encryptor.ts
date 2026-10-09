import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { argon2id } from 'hash-wasm';
import { EncryptedBlob } from './types';

/**
 * Encrypt a blob with AES-256-GCM.
 * Returns encrypted data (ciphertext + 16-byte auth tag appended) and the IV.
 */
export function encryptBlob(plaintext: Buffer, dek: Buffer): EncryptedBlob {
  const iv = randomBytes(12); // GCM nonce
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, authTag]), // append auth tag
    iv,
  };
}

/**
 * Wrap a DEK with a KEK using AES-256-GCM (envelope encryption).
 */
export function wrapDek(dek: Buffer, kek: Buffer): { encryptedDek: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedDek: Buffer.concat([encrypted, authTag]),
    nonce,
  };
}

/**
 * Generate a random 32-byte DEK.
 */
export function generateDek(): Buffer {
  return randomBytes(32);
}

/**
 * Derive KEK from passphrase + the vault's salt using Argon2id.
 * Parameters must match the app (key_derivation.dart) and the web client.
 */
export async function deriveKek(passphrase: string, salt: Buffer): Promise<Buffer> {
  const hash = await argon2id({
    password: Buffer.from(passphrase, 'utf-8'),
    salt,
    iterations: 3,
    memorySize: 65536, // KiB = 64MB
    parallelism: 1,
    hashLength: 32,
    outputType: 'binary',
  });
  return Buffer.from(hash);
}

/**
 * Decrypt a blob produced by encryptBlob (ciphertext + 16-byte auth tag).
 * Throws if the key is wrong or the data was tampered with.
 */
export function decryptBlob(encrypted: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  return Buffer.concat([
    decipher.update(encrypted.subarray(0, encrypted.length - 16)),
    decipher.final(),
  ]);
}

/**
 * True when the KEK decrypts the vault's verification token back to the vault id,
 * i.e. the passphrase is the right one for this vault.
 */
export function verifyKek(
  kek: Buffer,
  vault: { id: string; kekVerify: string; kekVerifyNonce: string },
): boolean {
  try {
    const plain = decryptBlob(
      Buffer.from(vault.kekVerify, 'base64'),
      kek,
      Buffer.from(vault.kekVerifyNonce, 'base64'),
    );
    return plain.toString('utf-8') === vault.id;
  } catch {
    return false;
  }
}

/**
 * Encrypt metadata JSON with vault's KEK.
 */
export function encryptMeta(
  meta: Record<string, unknown>,
  kek: Buffer,
): { encrypted: string; nonce: string } {
  const plaintext = Buffer.from(JSON.stringify(meta), 'utf-8');
  const { encrypted, iv } = encryptBlob(plaintext, kek);
  return {
    encrypted: encrypted.toString('base64'),
    nonce: iv.toString('base64'),
  };
}
