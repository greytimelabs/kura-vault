// The migration tool's own implementation of the Kura Vault key handling, on
// Node's crypto. It must read and write exactly the bytes the web client and the
// mobile app do; crypto-vectors.json at the repository root is what proves it.
import {
  createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes,
  verify as verifySignature, createHash, KeyObject,
} from 'crypto';
import { argon2id } from 'hash-wasm';
import { EncryptedBlob, Identity, UserKeys, VaultRow, WrappedKey } from './types';

const TAG_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

// ── Additional data and signed messages. Must match web/src/lib/crypto/aad.ts ──

const text = (...parts: string[]): Buffer => Buffer.from(`kura/v1/${parts.join('|')}`, 'utf-8');

export const aad = {
  userKeys: (userId: string) => text('user-keys', userId),
  vaultKeyPassphrase: (vaultId: string, userId: string) => text('vault-key-pass', vaultId, userId),
  vaultKey: (vaultId: string, userId: string) => text('vault-key', vaultId, userId),
  vaultLabel: (vaultId: string) => text('vault-label', vaultId),
  albumKey: (albumId: string, vaultId: string) => text('album-key', albumId, vaultId),
  albumKeyGrant: (albumId: string, userId: string) => text('album-key-grant', albumId, userId),
  albumName: (albumId: string) => text('album-name', albumId),
  mediaKeyVault: (mediaId: string, vaultId: string) => text('media-key', mediaId, 'vault', vaultId),
  mediaKeyAlbum: (mediaId: string, albumId: string) => text('media-key', mediaId, 'album', albumId),
  mediaBlob: (mediaId: string, tier: 'thumb' | 'preview' | 'original') => text('media-blob', mediaId, tier),
  mediaMeta: (mediaId: string) => text('media-meta', mediaId),
};

const signed = {
  cert: (user: UserKeys) => text('cert', user.userId, user.username, user.publicEncKey, user.publicSignKey),
  grant: (kind: 'vault' | 'album', resourceId: string, recipientId: string, granterId: string, sealed: Buffer) =>
    text('grant', kind, resourceId, recipientId, granterId, createHash('sha256').update(sealed).digest('base64')),
};

const SEAL_INFO = Buffer.from('kura/seal/v1', 'utf-8');

// ── AES-256-GCM: ciphertext followed by the 16-byte tag ──

/** Encrypt with a fresh random IV. `additional` binds the ciphertext to the ids it belongs to. */
export function encryptBlob(plaintext: Buffer, key: Buffer, additional?: Buffer, iv: Buffer = randomBytes(IV_LENGTH)): EncryptedBlob {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (additional) cipher.setAAD(additional);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { encrypted, iv };
}

/** Throws if the key or the additional data is wrong, or the data was tampered with. */
export function decryptBlob(encrypted: Buffer, key: Buffer, iv: Buffer, additional?: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  if (additional) decipher.setAAD(additional);
  decipher.setAuthTag(encrypted.subarray(encrypted.length - TAG_LENGTH));
  return Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - TAG_LENGTH)), decipher.final()]);
}

function wrap(key: Buffer, wrapping: Buffer, additional: Buffer): WrappedKey {
  const { encrypted, iv } = encryptBlob(key, wrapping, additional);
  return { wrapped: encrypted.toString('base64'), nonce: iv.toString('base64') };
}

function unwrap(wrapped: WrappedKey, wrapping: Buffer, additional: Buffer): Buffer {
  return decryptBlob(Buffer.from(wrapped.wrapped, 'base64'), wrapping, Buffer.from(wrapped.nonce, 'base64'), additional);
}

/**
 * Key from a passphrase (master or vault) with Argon2id.
 * Parameters must match the app (key_derivation.dart) and the web client.
 */
export async function derivePassphraseKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const hash = await argon2id({
    password: Buffer.from(passphrase, 'utf-8'),
    salt,
    iterations: 3,
    memorySize: 65536, // KiB = 64MB
    parallelism: 1,
    hashLength: KEY_LENGTH,
    outputType: 'binary',
  });
  return Buffer.from(hash);
}

// ── X25519 and Ed25519. Raw keys are 32 bytes; Node wants them in DER ──

const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

const privateKey = (prefix: Buffer, raw: Buffer): KeyObject =>
  createPrivateKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'pkcs8' });
const publicKey = (prefix: Buffer, raw: Buffer): KeyObject =>
  createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
const rawPublic = (key: KeyObject): Buffer => {
  const der = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
};

export const encPublicOf = (encSk: Buffer) => rawPublic(privateKey(X25519_PKCS8, encSk));
export const signPublicOf = (signSk: Buffer) => rawPublic(privateKey(ED25519_PKCS8, signSk));

function sealKey(sk: Buffer, peerPk: Buffer, ephPk: Buffer, recipientPk: Buffer): Buffer {
  const shared = diffieHellman({ privateKey: privateKey(X25519_PKCS8, sk), publicKey: publicKey(X25519_SPKI, peerPk) });
  // A low-order public key gives an all-zero secret that anyone can compute
  if (shared.every((b) => b === 0)) throw new Error('Invalid public key');
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephPk, recipientPk]), SEAL_INFO, KEY_LENGTH));
}

/** Encrypt to a public key: ephPk(32) ‖ iv(12) ‖ ciphertext+tag. `fixed` is for test vectors only. */
export function seal(recipientPk: Buffer, plaintext: Buffer, additional: Buffer, fixed?: { ephSk: Buffer; iv: Buffer }): Buffer {
  const ephSk = fixed?.ephSk ?? randomBytes(32);
  const ephPk = encPublicOf(ephSk);
  const key = sealKey(ephSk, recipientPk, ephPk, recipientPk);
  const { encrypted, iv } = encryptBlob(plaintext, key, additional, fixed?.iv);
  return Buffer.concat([ephPk, iv, encrypted]);
}

/** Open something sealed to this identity. Throws when it was not sealed to it or for this purpose. */
export function open(identity: Pick<Identity, 'encSk' | 'encPk'>, sealed: Buffer, additional: Buffer): Buffer {
  if (sealed.length < 32 + IV_LENGTH + TAG_LENGTH) throw new Error('Invalid sealed data');
  const ephPk = sealed.subarray(0, 32);
  const iv = sealed.subarray(32, 32 + IV_LENGTH);
  const key = sealKey(identity.encSk, ephPk, ephPk, identity.encPk);
  return decryptBlob(sealed.subarray(32 + IV_LENGTH), key, iv, additional);
}

function verify(signPk: Buffer, signature: Buffer, message: Buffer): boolean {
  if (signPk.length !== 32 || signature.length !== 64) return false;
  try {
    return verifySignature(null, message, publicKey(ED25519_SPKI, signPk), signature);
  } catch {
    return false;
  }
}

/** True when the server owner certified exactly these keys for exactly this user. */
export function verifyCert(ownerSignPk: Buffer, user: UserKeys): boolean {
  if (!user.keyCert) return false;
  return verify(ownerSignPk, Buffer.from(user.keyCert, 'base64'), signed.cert(user));
}

// ── Account ──

/**
 * Decrypt the account's private keys with the master passphrase. Throws on a
 * wrong passphrase, and when the server reports public keys that do not belong
 * to these private keys.
 */
export async function unlockAccount(
  account: {
    id: string;
    kdfSalt: string;
    encryptedPrivateKeys: string;
    privateKeysNonce: string;
    publicEncKey: string;
    publicSignKey: string;
  },
  passphrase: string,
): Promise<Identity> {
  const masterKey = await derivePassphraseKey(passphrase, Buffer.from(account.kdfSalt, 'base64'));
  let plain: Buffer;
  try {
    plain = decryptBlob(
      Buffer.from(account.encryptedPrivateKeys, 'base64'),
      masterKey,
      Buffer.from(account.privateKeysNonce, 'base64'),
      aad.userKeys(account.id),
    );
  } catch {
    throw new Error('Wrong master passphrase');
  } finally {
    masterKey.fill(0);
  }
  const bundle = JSON.parse(plain.toString('utf-8')) as { v: number; encSk: string; signSk: string; ownerSignPk: string };
  plain.fill(0);
  if (bundle.v !== 1) throw new Error('Unsupported key bundle');

  const encSk = Buffer.from(bundle.encSk, 'base64');
  const signSk = Buffer.from(bundle.signSk, 'base64');
  const encPk = encPublicOf(encSk);
  if (encPk.toString('base64') !== account.publicEncKey || signPublicOf(signSk).toString('base64') !== account.publicSignKey) {
    throw new Error('The server reports keys that are not yours. Do not continue; contact the server owner.');
  }
  return { userId: account.id, encSk, encPk, signSk, ownerSignPk: Buffer.from(bundle.ownerSignPk, 'base64') };
}

// ── Vault and album keys ──

/**
 * The key of a vault this account created: sealed to the account, and inside
 * that encrypted under the vault passphrase. Null when the passphrase is wrong.
 */
export async function openCreatorVaultKey(vault: VaultRow, passphrase: string, identity: Identity): Promise<Buffer | null> {
  if (!vault.kdfSalt) return null;
  const inner = open(identity, Buffer.from(vault.wrappedKey, 'base64'), aad.vaultKey(vault.id, identity.userId));
  const passphraseKey = await derivePassphraseKey(passphrase, Buffer.from(vault.kdfSalt, 'base64'));
  try {
    return decryptBlob(
      inner.subarray(IV_LENGTH),
      passphraseKey,
      inner.subarray(0, IV_LENGTH),
      aad.vaultKeyPassphrase(vault.id, identity.userId),
    );
  } catch {
    return null;
  } finally {
    passphraseKey.fill(0);
  }
}

function requireGrant(
  kind: 'vault' | 'album',
  resourceId: string,
  granter: UserKeys | null,
  signature: string | null,
  sealed: Buffer,
  identity: Identity,
): void {
  if (!granter || !signature) throw new Error('This share is not signed');
  if (!verifyCert(identity.ownerSignPk, granter)) throw new Error('The keys of whoever shared this are not verified');
  const message = signed.grant(kind, resourceId, identity.userId, granter.userId, sealed);
  if (!verify(Buffer.from(granter.publicSignKey, 'base64'), Buffer.from(signature, 'base64'), message)) {
    throw new Error('This share was not issued by its stated sender');
  }
}

/** The key of a vault someone shared with this account. The share is used only if its sender signed it. */
export function openSharedVaultKey(vault: VaultRow, identity: Identity): Buffer {
  const sealed = Buffer.from(vault.wrappedKey, 'base64');
  requireGrant('vault', vault.id, vault.granter, vault.grantSig, sealed, identity);
  return open(identity, sealed, aad.vaultKey(vault.id, identity.userId));
}

/** The key of an album shared with this account on its own. */
export function openSharedAlbumKey(
  album: { id: string; wrappedKey: string; grantSig: string; granter: UserKeys | null },
  identity: Identity,
): Buffer {
  const sealed = Buffer.from(album.wrappedKey, 'base64');
  requireGrant('album', album.id, album.granter, album.grantSig, sealed, identity);
  return open(identity, sealed, aad.albumKeyGrant(album.id, identity.userId));
}

/** An album's key, through the key of the vault it is in. */
export function unwrapAlbumKey(album: { id: string; keyWrapped: string; keyNonce: string }, vaultId: string, vaultKey: Buffer): Buffer {
  return unwrap({ wrapped: album.keyWrapped, nonce: album.keyNonce }, vaultKey, aad.albumKey(album.id, vaultId));
}

export function decryptText(encrypted: string, nonce: string, key: Buffer, additional: Buffer): string {
  return decryptBlob(Buffer.from(encrypted, 'base64'), key, Buffer.from(nonce, 'base64'), additional).toString('utf-8');
}

// ── Media ──

export interface EncryptedMedia {
  keyWrappedVault: string;
  keyNonceVault: string;
  keyWrappedAlbum?: string;
  keyNonceAlbum?: string;
  thumb: EncryptedBlob;
  preview: EncryptedBlob;
  original: EncryptedBlob;
  encryptedMeta: string;
  metaNonce: string;
}

/**
 * One fresh key per file. The three tiers and the metadata are encrypted under
 * it, each bound to the item's id; the key itself is stored only wrapped: under
 * the vault key, and under the album key when the upload goes into an album.
 */
export function encryptMedia(input: {
  mediaId: string;
  vaultId: string;
  vaultKey: Buffer;
  album?: { id: string; key: Buffer };
  thumb: Buffer;
  preview: Buffer;
  original: Buffer;
  meta: Record<string, unknown>;
}): EncryptedMedia {
  const mediaKey = randomBytes(KEY_LENGTH);
  try {
    const vaultWrap = wrap(mediaKey, input.vaultKey, aad.mediaKeyVault(input.mediaId, input.vaultId));
    const albumWrap = input.album
      ? wrap(mediaKey, input.album.key, aad.mediaKeyAlbum(input.mediaId, input.album.id))
      : null;
    const meta = encryptBlob(Buffer.from(JSON.stringify(input.meta), 'utf-8'), mediaKey, aad.mediaMeta(input.mediaId));
    return {
      keyWrappedVault: vaultWrap.wrapped,
      keyNonceVault: vaultWrap.nonce,
      ...(albumWrap ? { keyWrappedAlbum: albumWrap.wrapped, keyNonceAlbum: albumWrap.nonce } : {}),
      thumb: encryptBlob(input.thumb, mediaKey, aad.mediaBlob(input.mediaId, 'thumb')),
      preview: encryptBlob(input.preview, mediaKey, aad.mediaBlob(input.mediaId, 'preview')),
      original: encryptBlob(input.original, mediaKey, aad.mediaBlob(input.mediaId, 'original')),
      encryptedMeta: meta.encrypted.toString('base64'),
      metaNonce: meta.iv.toString('base64'),
    };
  } finally {
    mediaKey.fill(0);
  }
}

/** An item's key, from its vault wrap. */
export function unwrapMediaKey(wrapped: WrappedKey, mediaId: string, vaultId: string, vaultKey: Buffer): Buffer {
  return unwrap(wrapped, vaultKey, aad.mediaKeyVault(mediaId, vaultId));
}

/** An item's key, from one of its album wraps. */
export function unwrapMediaKeyFromAlbum(wrapped: WrappedKey, mediaId: string, albumId: string, albumKey: Buffer): Buffer {
  return unwrap(wrapped, albumKey, aad.mediaKeyAlbum(mediaId, albumId));
}
