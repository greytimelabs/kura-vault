import { argon2id } from 'hash-wasm';
import { KEY_LENGTH } from './aesgcm';
import { utf8Encode, type Bytes } from './base64';

// Must stay identical to app/lib/core/crypto/key_derivation.dart
export const KDF_PARAMS = {
  iterations: 3,
  memorySize: 65536, // KiB = 64 MiB
  parallelism: 1,
  hashLength: KEY_LENGTH,
} as const;

/**
 * Derive the raw 32-byte KEK. The passphrase is UTF-8 encoded as typed, with no
 * Unicode normalisation, because the Flutter app does not normalise either.
 * The caller owns the result and must zero it.
 */
export async function deriveKekBytes(passphrase: string, salt: Bytes): Promise<Bytes> {
  const password = utf8Encode(passphrase);
  try {
    const out = await argon2id({ ...KDF_PARAMS, password, salt, outputType: 'binary' });
    return new Uint8Array(out);
  } finally {
    password.fill(0);
  }
}
