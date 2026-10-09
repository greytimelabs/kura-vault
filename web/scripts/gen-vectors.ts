// Writes ../crypto-vectors.json: fixed inputs and the outputs this implementation
// produces for them. The Flutter and CLI test suites recompute every entry, so a
// passing run on all three proves the implementations are byte-compatible.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aad } from '../src/lib/crypto/aad';
import { concat, gcmEncrypt, importAesKey } from '../src/lib/crypto/aesgcm';
import { KDF_PARAMS, deriveKekBytes } from '../src/lib/crypto/argon2';
import { b64encode, hexEncode, utf8Decode, utf8Encode, type Bytes } from '../src/lib/crypto/base64';
import {
  encPublicOf,
  encryptBundle,
  importSignPrivate,
  inviteAuthToken,
  inviteBinding,
  seal,
  signCert,
  signGrant,
  signPublicOf,
} from '../src/lib/crypto/identity';

const seq = (length: number, start: number, step = 1): Bytes =>
  Uint8Array.from({ length }, (_, i) => (start + i * step) & 0xff);

async function encrypt(keyBytes: Bytes, iv: Bytes, plaintext: Bytes, additional?: Bytes): Promise<Bytes> {
  return gcmEncrypt(await importAesKey(keyBytes, ['encrypt']), iv, plaintext, additional);
}

const kdfInputs = [
  { passphrase: 'correct horse battery staple', salt: seq(16, 1) },
  { passphrase: 'pässwörd-日本語-🔐', salt: seq(16, 200, 3) },
  { passphrase: 'a', salt: seq(16, 0, 17) },
];

const kdf = [];
for (const input of kdfInputs) {
  const kek = await deriveKekBytes(input.passphrase, input.salt);
  kdf.push({ passphrase: input.passphrase, salt: b64encode(input.salt), kek: hexEncode(kek) });
}

const gcmInputs = [
  { key: seq(32, 7), iv: seq(12, 100), plaintext: utf8Encode('hello media vault'), aad: null },
  { key: seq(32, 90, 5), iv: seq(12, 3, 7), plaintext: new Uint8Array(0) as Bytes, aad: null },
  { key: seq(32, 250, 9), iv: seq(12, 77), plaintext: seq(1000, 0, 13), aad: 'kura/v1/example|with|ids' },
];

const gcm = [];
for (const input of gcmInputs) {
  const additional = input.aad ? utf8Encode(input.aad) : undefined;
  const ciphertext = await encrypt(input.key, input.iv, input.plaintext, additional);
  gcm.push({
    key: hexEncode(input.key),
    iv: b64encode(input.iv),
    aad: input.aad,
    plaintext: b64encode(input.plaintext),
    ciphertext: b64encode(ciphertext),
  });
}

// Two users: the server owner and a member the owner invited.
async function user(userId: string, username: string, encSk: Bytes, signSk: Bytes) {
  const encPk = await encPublicOf(encSk);
  const signPk = await signPublicOf(signSk);
  return {
    userId,
    username,
    encSk,
    signSk,
    encPk,
    signPk,
    keys: { userId, username, publicEncKey: b64encode(encPk), publicSignKey: b64encode(signPk) },
  };
}

const owner = await user('0b6f3c52-2f0e-4a51-9a3d-6f1c2b7e8d90', 'owner', seq(32, 1, 3), seq(32, 2, 5));
const member = await user('c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f', 'mira.k', seq(32, 9, 7), seq(32, 4, 11));
const ownerSign = await importSignPrivate(owner.signSk);

const publicUser = (u: typeof owner, keyCert: string) => ({
  ...u.keys,
  keyCert,
  encSk: b64encode(u.encSk),
  signSk: b64encode(u.signSk),
});
const ownerCert = await signCert(ownerSign, owner.keys);
const memberCert = await signCert(ownerSign, member.keys);

// The member's private bundle under their master passphrase
const masterPassphrase = 'interop master passphrase';
const masterSalt = seq(16, 61, 3);
const masterKey = await importAesKey(await deriveKekBytes(masterPassphrase, masterSalt), ['encrypt']);
const bundle = await encryptBundle(
  masterKey,
  member.userId,
  { encSk: member.encSk, signSk: member.signSk, ownerSignPk: owner.signPk },
  seq(12, 19, 3),
);

// Plain seal, to test the construction on its own
const sealAad = 'kura/v1/example|seal';
const sealPlain = utf8Encode('sealed for one reader');
const sealFixed = { ephSk: seq(32, 33, 9), iv: seq(12, 44, 5) };
const sealed = await seal(member.encPk, sealPlain, utf8Encode(sealAad), sealFixed);

// The invite that brought the member in
const inviteSecret = seq(32, 120, 7);

// A vault the owner created, with an album and one media item in both
const vaultId = '3f2b8c1e-7a4d-4e9b-9c55-0d1e2f3a4b5c';
const albumId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const mediaId = '9b2d5e1a-3c4f-4a6b-8d7e-1f2a3b4c5d6e';
const vaultPassphrase = 'interop vault passphrase';
const vaultSalt = seq(16, 42, 5);
const vaultLabel = 'Family';
const vaultKey = seq(32, 17, 9);
const albumKey = seq(32, 201, 3);
const mediaKey = seq(32, 64, 3);
const albumName = 'Summer 2024';

const passphraseKey = await deriveKekBytes(vaultPassphrase, vaultSalt);
const innerIv = seq(12, 11);
const inner = concat(
  innerIv,
  await encrypt(passphraseKey, innerIv, vaultKey, aad.vaultKeyPassphrase(vaultId, owner.userId)),
);
const creatorWrapped = await seal(owner.encPk, inner, aad.vaultKey(vaultId, owner.userId), {
  ephSk: seq(32, 70, 3),
  iv: seq(12, 81, 3),
});

const vaultShare = await seal(member.encPk, vaultKey, aad.vaultKey(vaultId, member.userId), {
  ephSk: seq(32, 5, 13),
  iv: seq(12, 9, 9),
});
const albumShare = await seal(member.encPk, albumKey, aad.albumKeyGrant(albumId, member.userId), {
  ephSk: seq(32, 77, 15),
  iv: seq(12, 14, 11),
});

const labelNonce = seq(12, 23);
const albumKeyNonce = seq(12, 51, 3);
const albumNameNonce = seq(12, 67, 5);
const vaultWrapNonce = seq(12, 5, 2);
const albumWrapNonce = seq(12, 8, 6);
const thumbIv = seq(12, 150);
const thumbPlain = seq(256, 9, 7);
const meta = JSON.stringify({ filename: 'IMG_0001.jpg', gpsLatitude: 12.5, gpsLongitude: 77.25 });
const metaNonce = seq(12, 31, 3);

const vectors = {
  description: 'Generated by web/scripts/gen-vectors.ts. Do not edit by hand.',
  kdfParams: { algorithm: 'argon2id', version: 19, ...KDF_PARAMS },
  kdf,
  gcm,
  seal: {
    recipientEncSk: b64encode(member.encSk),
    recipientEncPk: b64encode(member.encPk),
    ephSk: b64encode(sealFixed.ephSk),
    iv: b64encode(sealFixed.iv),
    aad: sealAad,
    plaintext: utf8Decode(sealPlain),
    sealed: b64encode(sealed),
  },
  users: {
    owner: publicUser(owner, ownerCert),
    member: publicUser(member, memberCert),
  },
  account: {
    userId: member.userId,
    passphrase: masterPassphrase,
    kdfSalt: b64encode(masterSalt),
    encryptedPrivateKeys: bundle.encrypted,
    privateKeysNonce: bundle.nonce,
  },
  invite: {
    secret: b64encode(inviteSecret),
    authToken: b64encode(await inviteAuthToken(inviteSecret)),
    keyBinding: b64encode(await inviteBinding(inviteSecret, member.keys)),
  },
  vault: {
    id: vaultId,
    passphrase: vaultPassphrase,
    label: vaultLabel,
    key: hexEncode(vaultKey),
    creator: {
      kdfSalt: b64encode(vaultSalt),
      innerIv: b64encode(innerIv),
      ephSk: b64encode(seq(32, 70, 3)),
      iv: b64encode(seq(12, 81, 3)),
      wrappedKey: b64encode(creatorWrapped),
    },
    share: {
      ephSk: b64encode(seq(32, 5, 13)),
      iv: b64encode(seq(12, 9, 9)),
      wrappedKey: b64encode(vaultShare),
      grantSig: await signGrant(ownerSign, 'vault', vaultId, member.userId, owner.userId, vaultShare),
    },
    labelEncrypted: b64encode(await encrypt(vaultKey, labelNonce, utf8Encode(vaultLabel), aad.vaultLabel(vaultId))),
    labelNonce: b64encode(labelNonce),
  },
  album: {
    id: albumId,
    name: albumName,
    key: hexEncode(albumKey),
    keyWrapped: b64encode(await encrypt(vaultKey, albumKeyNonce, albumKey, aad.albumKey(albumId, vaultId))),
    keyNonce: b64encode(albumKeyNonce),
    nameEncrypted: b64encode(await encrypt(albumKey, albumNameNonce, utf8Encode(albumName), aad.albumName(albumId))),
    nameNonce: b64encode(albumNameNonce),
    share: {
      ephSk: b64encode(seq(32, 77, 15)),
      iv: b64encode(seq(12, 14, 11)),
      wrappedKey: b64encode(albumShare),
      grantSig: await signGrant(ownerSign, 'album', albumId, member.userId, owner.userId, albumShare),
    },
  },
  media: {
    id: mediaId,
    key: hexEncode(mediaKey),
    vaultWrap: {
      wrapped: b64encode(await encrypt(vaultKey, vaultWrapNonce, mediaKey, aad.mediaKeyVault(mediaId, vaultId))),
      nonce: b64encode(vaultWrapNonce),
    },
    albumWrap: {
      wrapped: b64encode(await encrypt(albumKey, albumWrapNonce, mediaKey, aad.mediaKeyAlbum(mediaId, albumId))),
      nonce: b64encode(albumWrapNonce),
    },
    thumbIv: b64encode(thumbIv),
    thumbCiphertext: b64encode(await encrypt(mediaKey, thumbIv, thumbPlain, aad.mediaBlob(mediaId, 'thumb'))),
    thumbPlaintext: b64encode(thumbPlain),
    meta,
    encryptedMeta: b64encode(await encrypt(mediaKey, metaNonce, utf8Encode(meta), aad.mediaMeta(mediaId))),
    metaNonce: b64encode(metaNonce),
  },
};

const out = fileURLToPath(new URL('../../crypto-vectors.json', import.meta.url));
writeFileSync(out, JSON.stringify(vectors, null, 2) + '\n');
console.log(`wrote ${out}`);
