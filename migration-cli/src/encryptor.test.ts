import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aad, decryptBlob, decryptText, derivePassphraseKey, encPublicOf, encryptBlob, encryptMedia, open,
  openCreatorVaultKey, openSharedAlbumKey, openSharedVaultKey, seal, signPublicOf, unlockAccount, unwrapAlbumKey,
  unwrapMediaKey, unwrapMediaKeyFromAlbum, verifyCert,
} from './encryptor';
import { Identity, VaultRow } from './types';

// Shared with the web client and the Flutter app; see web/scripts/gen-vectors.ts
const vectors = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'crypto-vectors.json'), 'utf-8'),
);

const b64 = (value: string) => Buffer.from(value, 'base64');
const { owner, member } = vectors.users;
const ownerSignPk = b64(owner.publicSignKey);

const identityOf = (user: typeof owner): Identity => ({
  userId: user.userId,
  encSk: b64(user.encSk),
  encPk: b64(user.publicEncKey),
  signSk: b64(user.signSk),
  ownerSignPk,
});

test('Argon2id derivation matches the shared vectors', async () => {
  for (const v of vectors.kdf) {
    const kek = await derivePassphraseKey(v.passphrase, b64(v.salt));
    assert.equal(kek.toString('hex'), v.kek, `passphrase ${v.passphrase}`);
  }
});

test('AES-256-GCM layout matches the shared vectors, with and without additional data', () => {
  for (const v of vectors.gcm) {
    const key = Buffer.from(v.key, 'hex');
    const iv = b64(v.iv);
    const additional = v.aad ? Buffer.from(v.aad, 'utf-8') : undefined;
    const plaintext = b64(v.plaintext);

    assert.equal(encryptBlob(plaintext, key, additional, iv).encrypted.toString('base64'), v.ciphertext);
    assert.deepEqual(decryptBlob(b64(v.ciphertext), key, iv, additional), plaintext);
  }
});

test('public keys are derived the same way', () => {
  for (const user of [owner, member]) {
    assert.equal(encPublicOf(b64(user.encSk)).toString('base64'), user.publicEncKey);
    assert.equal(signPublicOf(b64(user.signSk)).toString('base64'), user.publicSignKey);
  }
});

test('sealing produces and opens the same bytes', () => {
  const v = vectors.seal;
  const additional = Buffer.from(v.aad, 'utf-8');
  const sealed = seal(b64(v.recipientEncPk), Buffer.from(v.plaintext, 'utf-8'), additional, { ephSk: b64(v.ephSk), iv: b64(v.iv) });
  assert.equal(sealed.toString('base64'), v.sealed);

  const reader = { encSk: b64(v.recipientEncSk), encPk: b64(v.recipientEncPk) };
  assert.equal(open(reader, b64(v.sealed), additional).toString('utf-8'), v.plaintext);
  assert.throws(() => open(reader, b64(v.sealed), Buffer.from('kura/v1/other', 'utf-8')));
  assert.throws(() => seal(Buffer.alloc(32), Buffer.from('x'), additional));
});

test('certificates verify, and stop verifying when anything certified changes', () => {
  assert.equal(verifyCert(ownerSignPk, owner), true);
  assert.equal(verifyCert(ownerSignPk, member), true);
  assert.equal(verifyCert(ownerSignPk, { ...member, publicEncKey: owner.publicEncKey }), false);
  assert.equal(verifyCert(ownerSignPk, { ...member, username: 'someone.else' }), false);
  assert.equal(verifyCert(ownerSignPk, { ...member, keyCert: null }), false);
  assert.equal(verifyCert(b64(member.publicSignKey), member), false);
});

test('the master passphrase opens the account, and only the right one', async () => {
  const v = vectors.account;
  const account = { id: v.userId, ...v, publicEncKey: member.publicEncKey, publicSignKey: member.publicSignKey };
  const identity = await unlockAccount(account, v.passphrase);
  assert.equal(identity.encSk.toString('base64'), member.encSk);
  assert.equal(identity.ownerSignPk.toString('base64'), owner.publicSignKey);

  await assert.rejects(unlockAccount(account, `${v.passphrase}x`), /Wrong master passphrase/);
  // A server that swaps the account's public key is noticed
  await assert.rejects(unlockAccount({ ...account, publicEncKey: owner.publicEncKey }, v.passphrase), /not yours/);
});

test('a created vault needs its passphrase; a shared one needs its sender\'s signature', async () => {
  const { vault } = vectors;
  const created: VaultRow = {
    id: vault.id, role: 'creator', permission: 'write',
    wrappedKey: vault.creator.wrappedKey, kdfSalt: vault.creator.kdfSalt, grantSig: null, granter: null,
  };
  const key = await openCreatorVaultKey(created, vault.passphrase, identityOf(owner));
  assert.equal(key?.toString('hex'), vault.key);
  assert.equal(await openCreatorVaultKey(created, `${vault.passphrase}x`, identityOf(owner)), null);

  const shared: VaultRow = {
    id: vault.id, role: 'member', permission: 'write',
    wrappedKey: vault.share.wrappedKey, kdfSalt: null, grantSig: vault.share.grantSig, granter: owner,
  };
  assert.equal(openSharedVaultKey(shared, identityOf(member)).toString('hex'), vault.key);
  // Unsigned, signed by someone else, or from an uncertified sender: refused
  assert.throws(() => openSharedVaultKey({ ...shared, grantSig: null }, identityOf(member)), /not signed/);
  assert.throws(() => openSharedVaultKey({ ...shared, grantSig: vectors.album.share.grantSig }, identityOf(member)), /not issued/);
  assert.throws(() => openSharedVaultKey({ ...shared, granter: { ...owner, keyCert: null } }, identityOf(member)), /not verified/);
});

test('album keys, media keys, a thumbnail and the metadata all open', () => {
  const { vault, album, media } = vectors;
  const vaultKey = Buffer.from(vault.key, 'hex');

  assert.equal(decryptText(vault.labelEncrypted, vault.labelNonce, vaultKey, aad.vaultLabel(vault.id)), vault.label);

  const albumKey = unwrapAlbumKey(album, vault.id, vaultKey);
  assert.equal(albumKey.toString('hex'), album.key);
  assert.equal(decryptText(album.nameEncrypted, album.nameNonce, albumKey, aad.albumName(album.id)), album.name);
  const sharedAlbum = { id: album.id, wrappedKey: album.share.wrappedKey, grantSig: album.share.grantSig, granter: owner };
  assert.equal(openSharedAlbumKey(sharedAlbum, identityOf(member)).toString('hex'), album.key);

  for (const mediaKey of [
    unwrapMediaKey(media.vaultWrap, media.id, vault.id, vaultKey),
    unwrapMediaKeyFromAlbum(media.albumWrap, media.id, album.id, albumKey),
  ]) {
    assert.equal(mediaKey.toString('hex'), media.key);
    const thumb = decryptBlob(b64(media.thumbCiphertext), mediaKey, b64(media.thumbIv), aad.mediaBlob(media.id, 'thumb'));
    assert.equal(thumb.toString('base64'), media.thumbPlaintext);
    assert.equal(decryptText(media.encryptedMeta, media.metaNonce, mediaKey, aad.mediaMeta(media.id)), media.meta);
  }
  // A wrapped key does not open for another item
  assert.throws(() => unwrapMediaKey(media.vaultWrap, album.id, vault.id, vaultKey));
});

test('what this tool encrypts can be decrypted again, and only as the item it was made for', () => {
  const vaultKey = Buffer.from(vectors.vault.key, 'hex');
  const albumKey = Buffer.from(vectors.album.key, 'hex');
  const original = Buffer.from('original bytes');
  const out = encryptMedia({
    mediaId: 'm1', vaultId: 'v1', vaultKey, album: { id: 'a1', key: albumKey },
    thumb: Buffer.from('t'), preview: Buffer.from('p'), original, meta: { filename: 'a.jpg' },
  });

  const viaVault = unwrapMediaKey({ wrapped: out.keyWrappedVault, nonce: out.keyNonceVault }, 'm1', 'v1', vaultKey);
  const viaAlbum = unwrapMediaKeyFromAlbum({ wrapped: out.keyWrappedAlbum!, nonce: out.keyNonceAlbum! }, 'm1', 'a1', albumKey);
  assert.deepEqual(viaVault, viaAlbum);
  assert.deepEqual(decryptBlob(out.original.encrypted, viaVault, out.original.iv, aad.mediaBlob('m1', 'original')), original);
  // One tier cannot be passed off as another, or as another item's
  assert.throws(() => decryptBlob(out.original.encrypted, viaVault, out.original.iv, aad.mediaBlob('m1', 'thumb')));
  assert.throws(() => decryptBlob(out.original.encrypted, viaVault, out.original.iv, aad.mediaBlob('m2', 'original')));
  assert.equal(JSON.parse(decryptText(out.encryptedMeta, out.metaNonce, viaVault, aad.mediaMeta('m1'))).filename, 'a.jpg');
});
