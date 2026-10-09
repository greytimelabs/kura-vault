// A user's identity: an X25519 key to receive vault and album keys, and an
// Ed25519 key to sign what they share. Raw key format everywhere is 32 bytes;
// WebCrypto only imports private keys as PKCS#8, hence the fixed prefixes.
import { IV_LENGTH, concat, gcmDecrypt, gcmEncrypt, randomBytes, zero } from './aesgcm';
import { INFO, aad, signed } from './aad';
import { b64decode, b64encode, hexDecode, utf8Decode, utf8Encode, type Bytes } from './base64';

const X25519_PKCS8_PREFIX = hexDecode('302e020100300506032b656e04220420');
const ED25519_PKCS8_PREFIX = hexDecode('302e020100300506032b657004220420');
export const PUBLIC_KEY_LENGTH = 32;
export const SIGNATURE_LENGTH = 64;
export const INVITE_SECRET_LENGTH = 32;

/** False in a browser too old to do this client's public-key cryptography. */
export async function identitySupported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

function b64urlToBytes(value: string): Bytes {
  return b64decode(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
}

async function importPrivate(
  prefix: Bytes,
  raw: Bytes,
  name: 'X25519' | 'Ed25519',
  extractable: boolean,
): Promise<CryptoKey> {
  const pkcs8 = concat(prefix, raw);
  try {
    return await crypto.subtle.importKey('pkcs8', pkcs8, { name }, extractable, name === 'X25519' ? ['deriveBits'] : ['sign']);
  } finally {
    zero(pkcs8);
  }
}

export const importEncPrivate = (raw: Bytes, extractable = false) =>
  importPrivate(X25519_PKCS8_PREFIX, raw, 'X25519', extractable);
export const importSignPrivate = (raw: Bytes, extractable = false) =>
  importPrivate(ED25519_PKCS8_PREFIX, raw, 'Ed25519', extractable);

const importEncPublic = (raw: Bytes) => crypto.subtle.importKey('raw', raw, { name: 'X25519' }, true, []);
const importSignPublic = (raw: Bytes) => crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, true, ['verify']);

/** The public half of a raw private key. */
async function publicOf(prefix: Bytes, raw: Bytes, name: 'X25519' | 'Ed25519'): Promise<Bytes> {
  const key = await importPrivate(prefix, raw, name, true);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return b64urlToBytes(jwk.x!);
}

export const encPublicOf = (raw: Bytes) => publicOf(X25519_PKCS8_PREFIX, raw, 'X25519');
export const signPublicOf = (raw: Bytes) => publicOf(ED25519_PKCS8_PREFIX, raw, 'Ed25519');

export interface RawIdentity {
  encSk: Bytes;
  encPk: Bytes;
  signSk: Bytes;
  signPk: Bytes;
}

/** Fresh random keys. The caller owns the private bytes and must zero them. */
export async function generateIdentity(): Promise<RawIdentity> {
  const enc = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const sign = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const rawPrivate = async (key: CryptoKey): Promise<Bytes> => {
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', key));
    const raw = pkcs8.slice(-32);
    zero(pkcs8);
    return raw;
  };
  return {
    encSk: await rawPrivate(enc.privateKey),
    encPk: new Uint8Array(await crypto.subtle.exportKey('raw', enc.publicKey)),
    signSk: await rawPrivate(sign.privateKey),
    signPk: new Uint8Array(await crypto.subtle.exportKey('raw', sign.publicKey)),
  };
}

async function sealKey(encPrivate: CryptoKey, peerPk: Bytes, ephPk: Bytes, recipientPk: Bytes, usage: KeyUsage) {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'X25519', public: await importEncPublic(peerPk) }, encPrivate, 256),
  );
  try {
    // A low-order public key gives an all-zero secret that anyone can compute
    if (shared.every((b) => b === 0)) throw new Error('Invalid public key');
    const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: concat(ephPk, recipientPk), info: INFO.seal },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage],
    );
  } finally {
    zero(shared);
  }
}

/**
 * Encrypt to a public key: ephemeral X25519, HKDF-SHA256, AES-256-GCM.
 * Output is ephPk(32) ‖ iv(12) ‖ ciphertext+tag. `fixed` exists for test vectors only.
 */
export async function seal(
  recipientPk: Bytes,
  plaintext: Bytes,
  additional: Bytes,
  fixed?: { ephSk: Bytes; iv: Bytes },
): Promise<Bytes> {
  if (recipientPk.length !== PUBLIC_KEY_LENGTH) throw new Error('Invalid public key');
  let ephPrivate: CryptoKey;
  let ephPk: Bytes;
  if (fixed) {
    ephPrivate = await importEncPrivate(fixed.ephSk);
    ephPk = await encPublicOf(fixed.ephSk);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    ephPrivate = pair.privateKey;
    ephPk = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }
  const key = await sealKey(ephPrivate, recipientPk, ephPk, recipientPk, 'encrypt');
  const iv = fixed?.iv ?? randomBytes(IV_LENGTH);
  return concat(ephPk, iv, await gcmEncrypt(key, iv, plaintext, additional));
}

/** Open something sealed to `myPk`. Rejects when it was not sealed to this key or for this purpose. */
export async function open(encPrivate: CryptoKey, myPk: Bytes, sealed: Bytes, additional: Bytes): Promise<Bytes> {
  if (sealed.length < PUBLIC_KEY_LENGTH + IV_LENGTH + 16) throw new Error('Invalid sealed data');
  const ephPk = sealed.slice(0, PUBLIC_KEY_LENGTH);
  const iv = sealed.slice(PUBLIC_KEY_LENGTH, PUBLIC_KEY_LENGTH + IV_LENGTH);
  const key = await sealKey(encPrivate, ephPk, ephPk, myPk, 'decrypt');
  return gcmDecrypt(key, iv, sealed.slice(PUBLIC_KEY_LENGTH + IV_LENGTH), additional);
}

export async function sign(signPrivate: CryptoKey, message: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, signPrivate, message));
}

export async function verify(signPk: Bytes, signature: Bytes, message: Bytes): Promise<boolean> {
  if (signPk.length !== PUBLIC_KEY_LENGTH || signature.length !== SIGNATURE_LENGTH) return false;
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, await importSignPublic(signPk), signature, message);
  } catch {
    return false;
  }
}

export async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** What a user's private bundle holds once decrypted. */
export interface PrivateBundle {
  encSk: Bytes;
  signSk: Bytes;
  /** The server owner's signing key: the root this user trusts other users' keys through. */
  ownerSignPk: Bytes;
}

export interface EncryptedBundle {
  encrypted: string;
  nonce: string;
}

/** Encrypt the private keys under the master key. `iv` is for test vectors only. */
export async function encryptBundle(
  masterKey: CryptoKey,
  userId: string,
  bundle: PrivateBundle,
  iv: Bytes = randomBytes(IV_LENGTH),
): Promise<EncryptedBundle> {
  const plain = utf8Encode(
    JSON.stringify({
      v: 1,
      encSk: b64encode(bundle.encSk),
      signSk: b64encode(bundle.signSk),
      ownerSignPk: b64encode(bundle.ownerSignPk),
    }),
  );
  try {
    return { encrypted: b64encode(await gcmEncrypt(masterKey, iv, plain, aad.userKeys(userId))), nonce: b64encode(iv) };
  } finally {
    zero(plain);
  }
}

/** Rejects on a wrong master passphrase. The caller must zero the private bytes. */
export async function decryptBundle(
  masterKey: CryptoKey,
  userId: string,
  encrypted: string,
  nonce: string,
): Promise<PrivateBundle> {
  const plain = await gcmDecrypt(masterKey, b64decode(nonce), b64decode(encrypted), aad.userKeys(userId));
  try {
    const parsed = JSON.parse(utf8Decode(plain)) as { v: number; encSk: string; signSk: string; ownerSignPk: string };
    if (parsed.v !== 1) throw new Error('Unsupported key bundle');
    return {
      encSk: b64decode(parsed.encSk),
      signSk: b64decode(parsed.signSk),
      ownerSignPk: b64decode(parsed.ownerSignPk),
    };
  } finally {
    zero(plain);
  }
}

/** Public facts about a user, as the server reports them. Untrusted until the certificate verifies. */
export interface UserKeys {
  userId: string;
  username: string;
  publicEncKey: string;
  publicSignKey: string;
  keyCert: string | null;
}

export async function signCert(ownerSignPrivate: CryptoKey, user: Omit<UserKeys, 'keyCert'>): Promise<string> {
  const message = signed.cert(user.userId, user.username, user.publicEncKey, user.publicSignKey);
  return b64encode(await sign(ownerSignPrivate, message));
}

/** True when the owner certified exactly these keys for exactly this user. */
export async function verifyCert(ownerSignPk: Bytes, user: UserKeys): Promise<boolean> {
  if (!user.keyCert) return false;
  try {
    const message = signed.cert(user.userId, user.username, user.publicEncKey, user.publicSignKey);
    return await verify(ownerSignPk, b64decode(user.keyCert), message);
  } catch {
    return false;
  }
}

async function grantMessage(
  kind: 'vault' | 'album',
  resourceId: string,
  recipientId: string,
  granterId: string,
  sealed: Bytes,
): Promise<Bytes> {
  return signed.grant(kind, resourceId, recipientId, granterId, b64encode(await sha256(sealed)));
}

export async function signGrant(
  signPrivate: CryptoKey,
  kind: 'vault' | 'album',
  resourceId: string,
  recipientId: string,
  granterId: string,
  sealed: Bytes,
): Promise<string> {
  return b64encode(await sign(signPrivate, await grantMessage(kind, resourceId, recipientId, granterId, sealed)));
}

export async function verifyGrant(
  granterSignPk: Bytes,
  signature: string,
  kind: 'vault' | 'album',
  resourceId: string,
  recipientId: string,
  granterId: string,
  sealed: Bytes,
): Promise<boolean> {
  try {
    return await verify(
      granterSignPk,
      b64decode(signature),
      await grantMessage(kind, resourceId, recipientId, granterId, sealed),
    );
  } catch {
    return false;
  }
}

async function hkdf(secret: Bytes, info: Bytes): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, key, 256),
  );
}

/** What the invitee shows the server to prove they hold the link. The server stores only its SHA-256. */
export const inviteAuthToken = (secret: Bytes) => hkdf(secret, INFO.inviteAuth);

/**
 * HMAC over the invitee's identity under a key only the link holders know. The
 * server never sees the link's secret, so it cannot produce this for keys of its own.
 */
export async function inviteBinding(secret: Bytes, user: Omit<UserKeys, 'keyCert'>): Promise<Bytes> {
  const bindKey = await hkdf(secret, INFO.inviteBind);
  try {
    const key = await crypto.subtle.importKey('raw', bindKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const message = signed.binding(user.userId, user.username, user.publicEncKey, user.publicSignKey);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  } finally {
    zero(bindKey);
  }
}

/** Compare without leaking where two values differ. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

