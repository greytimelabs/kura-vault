import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aad } from '../../src/lib/crypto/aad';
import { gcmDecrypt, gcmEncrypt, importAesKey, randomBytes } from '../../src/lib/crypto/aesgcm';
import { deriveKekBytes } from '../../src/lib/crypto/argon2';
import { b64decode, b64encode, hexDecode, hexEncode, utf8Decode, utf8Encode } from '../../src/lib/crypto/base64';
import {
  decryptBundle,
  encPublicOf,
  encryptBundle,
  equalBytes,
  generateIdentity,
  importEncPrivate,
  importSignPrivate,
  inviteAuthToken,
  inviteBinding,
  open,
  seal,
  signCert,
  signGrant,
  signPublicOf,
  verifyCert,
  verifyGrant,
  type UserKeys,
} from '../../src/lib/crypto/identity';
import {
  decryptText,
  derivePassphraseKey,
  encryptText,
  generateMediaKey,
  generateScopeKey,
  importScopeKey,
  openCreatorGrantInner,
  openCreatorGrantOuter,
  openScopeKey,
  sealScopeKey,
  unwrapKey,
  unwrapScopeKey,
  wrapCreatorGrant,
  wrapKey,
} from '../../src/lib/crypto/vaultCrypto';

// The migration CLI's own implementation, to prove its uploads open in the browser
import * as cli from '../../../migration-cli/src/encryptor';

// The same file the Flutter app and the CLI are tested against
const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../crypto-vectors.json', import.meta.url)), 'utf-8'),
);

const { owner, member } = vectors.users as Record<string, UserKeys & { encSk: string; signSk: string }>;
const ownerSignPk = b64decode(owner!.publicSignKey);
const memberEncPk = b64decode(member!.publicEncKey);
const memberEnc = () => importEncPrivate(b64decode(member!.encSk));

describe('shared interop vectors', () => {
  it('derives the same key for every passphrase', async () => {
    for (const v of vectors.kdf) {
      const kek = await deriveKekBytes(v.passphrase, b64decode(v.salt));
      expect(hexEncode(kek), v.passphrase).toBe(v.kek);
    }
  });

  it('produces and reads the same AES-GCM bytes, with and without additional data', async () => {
    for (const v of vectors.gcm) {
      const key = await importAesKey(hexDecode(v.key), ['encrypt', 'decrypt']);
      const iv = b64decode(v.iv);
      const additional = v.aad ? utf8Encode(v.aad) : undefined;
      expect(b64encode(await gcmEncrypt(key, iv, b64decode(v.plaintext), additional))).toBe(v.ciphertext);
      expect(b64encode(await gcmDecrypt(key, iv, b64decode(v.ciphertext), additional))).toBe(v.plaintext);
    }
  });

  it('derives the same public keys', async () => {
    for (const user of [owner!, member!]) {
      expect(b64encode(await encPublicOf(b64decode(user.encSk)))).toBe(user.publicEncKey);
      expect(b64encode(await signPublicOf(b64decode(user.signSk)))).toBe(user.publicSignKey);
    }
  });

  it('seals and opens the same bytes', async () => {
    const v = vectors.seal;
    const sealed = await seal(b64decode(v.recipientEncPk), utf8Encode(v.plaintext), utf8Encode(v.aad), {
      ephSk: b64decode(v.ephSk),
      iv: b64decode(v.iv),
    });
    expect(b64encode(sealed)).toBe(v.sealed);
    const opened = await open(await memberEnc(), memberEncPk, b64decode(v.sealed), utf8Encode(v.aad));
    expect(utf8Decode(opened)).toBe(v.plaintext);
  });

  it('verifies the certificates and reproduces them', async () => {
    const ownerSign = await importSignPrivate(b64decode(owner!.signSk));
    for (const user of [owner!, member!]) {
      expect(await verifyCert(ownerSignPk, user)).toBe(true);
      expect(await signCert(ownerSign, user)).toBe(user.keyCert);
    }
  });

  it('opens the private bundle with the master passphrase', async () => {
    const v = vectors.account;
    const masterKey = await derivePassphraseKey(v.passphrase, v.kdfSalt);
    const bundle = await decryptBundle(masterKey, v.userId, v.encryptedPrivateKeys, v.privateKeysNonce);
    expect(b64encode(bundle.encSk)).toBe(member!.encSk);
    expect(b64encode(bundle.signSk)).toBe(member!.signSk);
    expect(b64encode(bundle.ownerSignPk)).toBe(owner!.publicSignKey);

    const again = await encryptBundle(masterKey, v.userId, bundle, b64decode(v.privateKeysNonce));
    expect(again.encrypted).toBe(v.encryptedPrivateKeys);
  });

  it('derives the invite token and binding', async () => {
    const secret = b64decode(vectors.invite.secret);
    expect(b64encode(await inviteAuthToken(secret))).toBe(vectors.invite.authToken);
    expect(b64encode(await inviteBinding(secret, member!))).toBe(vectors.invite.keyBinding);
  });

  it('opens the vault as its creator, and reads the label, album, thumbnail and metadata', async () => {
    const { vault, album, media } = vectors;
    const ownerEnc = await importEncPrivate(b64decode(owner!.encSk));
    const inner = await openCreatorGrantOuter(ownerEnc, b64decode(owner!.publicEncKey), vault.creator, vault.id, owner!.userId);
    const vaultKey = await openCreatorGrantInner(inner, vault.passphrase, vault.creator.kdfSalt, vault.id, owner!.userId);
    expect(vaultKey).not.toBeNull();
    expect(hexEncode(new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey!)))).toBe(vault.key);

    expect(await decryptText(vaultKey!, vault.labelEncrypted, vault.labelNonce, aad.vaultLabel(vault.id))).toBe(vault.label);

    const albumKey = await unwrapScopeKey(
      vaultKey!,
      { wrapped: album.keyWrapped, nonce: album.keyNonce },
      aad.albumKey(album.id, vault.id),
    );
    expect(await decryptText(albumKey, album.nameEncrypted, album.nameNonce, aad.albumName(album.id))).toBe(album.name);

    // The same media key is reachable through the vault and through the album
    for (const key of [
      await unwrapKey(vaultKey!, media.vaultWrap, aad.mediaKeyVault(media.id, vault.id), ['decrypt'], false),
      await unwrapKey(albumKey, media.albumWrap, aad.mediaKeyAlbum(media.id, album.id), ['decrypt'], false),
    ]) {
      const thumb = await gcmDecrypt(key, b64decode(media.thumbIv), b64decode(media.thumbCiphertext), aad.mediaBlob(media.id, 'thumb'));
      expect(b64encode(thumb)).toBe(media.thumbPlaintext);
      expect(await decryptText(key, media.encryptedMeta, media.metaNonce, aad.mediaMeta(media.id))).toBe(media.meta);
    }
  });

  it('opens the vault and album shares as the recipient and checks who issued them', async () => {
    const { vault, album } = vectors;
    const enc = await memberEnc();
    const ownerSign = b64decode(owner!.publicSignKey);

    const vaultSealed = b64decode(vault.share.wrappedKey);
    expect(await verifyGrant(ownerSign, vault.share.grantSig, 'vault', vault.id, member!.userId, owner!.userId, vaultSealed)).toBe(true);
    const vaultKey = await openScopeKey(enc, memberEncPk, vaultSealed, aad.vaultKey(vault.id, member!.userId));
    expect(hexEncode(new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey)))).toBe(vault.key);

    const albumSealed = b64decode(album.share.wrappedKey);
    expect(await verifyGrant(ownerSign, album.share.grantSig, 'album', album.id, member!.userId, owner!.userId, albumSealed)).toBe(true);
    const albumKey = await openScopeKey(enc, memberEncPk, albumSealed, aad.albumKeyGrant(album.id, member!.userId));
    expect(hexEncode(new Uint8Array(await crypto.subtle.exportKey('raw', albumKey)))).toBe(album.key);
  });
});

describe('identity', () => {
  it('rejects a wrong master passphrase', async () => {
    const v = vectors.account;
    const wrong = await derivePassphraseKey(`${v.passphrase}x`, v.kdfSalt);
    await expect(decryptBundle(wrong, v.userId, v.encryptedPrivateKeys, v.privateKeysNonce)).rejects.toThrow();
  });

  it('does not open a bundle moved to another user', async () => {
    const v = vectors.account;
    const masterKey = await derivePassphraseKey(v.passphrase, v.kdfSalt);
    await expect(decryptBundle(masterKey, owner!.userId, v.encryptedPrivateKeys, v.privateKeysNonce)).rejects.toThrow();
  });

  it('seals differently each time and only for the intended reader and purpose', async () => {
    const reader = await generateIdentity();
    const other = await generateIdentity();
    const purpose = utf8Encode('kura/v1/test|a');
    const first = await seal(reader.encPk, utf8Encode('secret'), purpose);
    const second = await seal(reader.encPk, utf8Encode('secret'), purpose);
    expect(b64encode(first)).not.toBe(b64encode(second));

    const readerKey = await importEncPrivate(reader.encSk);
    expect(utf8Decode(await open(readerKey, reader.encPk, first, purpose))).toBe('secret');
    await expect(open(readerKey, reader.encPk, first, utf8Encode('kura/v1/test|b'))).rejects.toThrow();
    await expect(open(await importEncPrivate(other.encSk), other.encPk, first, purpose)).rejects.toThrow();

    first[first.length - 1]! ^= 1;
    await expect(open(readerKey, reader.encPk, first, purpose)).rejects.toThrow();
  });

  it('refuses to seal to a low-order public key', async () => {
    await expect(seal(new Uint8Array(32), utf8Encode('x'), utf8Encode('y'))).rejects.toThrow();
  });

  it('keeps private keys non-extractable once imported', async () => {
    const id = await generateIdentity();
    const enc = await importEncPrivate(id.encSk);
    const sign = await importSignPrivate(id.signSk);
    expect(enc.extractable).toBe(false);
    expect(sign.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', enc)).rejects.toThrow();
  });

  it('rejects a certificate when the server changes any certified field', async () => {
    const swapped = await generateIdentity();
    expect(await verifyCert(ownerSignPk, { ...member!, publicEncKey: b64encode(swapped.encPk) })).toBe(false);
    expect(await verifyCert(ownerSignPk, { ...member!, publicSignKey: b64encode(swapped.signPk) })).toBe(false);
    expect(await verifyCert(ownerSignPk, { ...member!, username: 'someone.else' })).toBe(false);
    expect(await verifyCert(ownerSignPk, { ...member!, userId: owner!.userId })).toBe(false);
    expect(await verifyCert(ownerSignPk, { ...member!, keyCert: null })).toBe(false);
    // A certificate from a different "owner" is worthless
    expect(await verifyCert(swapped.signPk, member!)).toBe(false);
  });

  it('rejects a grant that was not issued by the stated sharer, or was re-targeted', async () => {
    const forger = await generateIdentity();
    const sealed = await seal(memberEncPk, randomBytes(32), aad.vaultKey('v', member!.userId));
    const forged = await signGrant(await importSignPrivate(forger.signSk), 'vault', 'v', member!.userId, owner!.userId, sealed);
    expect(await verifyGrant(ownerSignPk, forged, 'vault', 'v', member!.userId, owner!.userId, sealed)).toBe(false);

    const real = await signGrant(await importSignPrivate(b64decode(owner!.signSk)), 'vault', 'v', member!.userId, owner!.userId, sealed);
    expect(await verifyGrant(ownerSignPk, real, 'vault', 'v', member!.userId, owner!.userId, sealed)).toBe(true);
    expect(await verifyGrant(ownerSignPk, real, 'vault', 'other', member!.userId, owner!.userId, sealed)).toBe(false);
    expect(await verifyGrant(ownerSignPk, real, 'album', 'v', member!.userId, owner!.userId, sealed)).toBe(false);
    const otherSealed = await seal(memberEncPk, randomBytes(32), aad.vaultKey('v', member!.userId));
    expect(await verifyGrant(ownerSignPk, real, 'vault', 'v', member!.userId, owner!.userId, otherSealed)).toBe(false);
  });

  it('binds an invite to the exact keys the invitee uploaded', async () => {
    const secret = b64decode(vectors.invite.secret);
    const expected = b64decode(vectors.invite.keyBinding);
    const swapped = await generateIdentity();
    const tampered = await inviteBinding(secret, { ...member!, publicEncKey: b64encode(swapped.encPk) });
    expect(equalBytes(tampered, expected)).toBe(false);
    expect(equalBytes(await inviteBinding(randomBytes(32), member!), expected)).toBe(false);
  });
});

describe('vault keys', () => {
  it('needs both the vault passphrase and the private key to open a creator grant', async () => {
    const me = await generateIdentity();
    const other = await generateIdentity();
    const vaultKey = await generateScopeKey();
    const grant = await wrapCreatorGrant(vaultKey, 'vault passphrase', 'vault-1', 'user-1', me.encPk);
    const enc = await importEncPrivate(me.encSk);

    await expect(
      openCreatorGrantOuter(await importEncPrivate(other.encSk), other.encPk, grant, 'vault-1', 'user-1'),
    ).rejects.toThrow();

    const inner = await openCreatorGrantOuter(enc, me.encPk, grant, 'vault-1', 'user-1');
    expect(await openCreatorGrantInner(inner, 'wrong passphrase', grant.kdfSalt, 'vault-1', 'user-1')).toBeNull();
    expect(await openCreatorGrantInner(inner, 'vault passphrase', grant.kdfSalt, 'vault-2', 'user-1')).toBeNull();

    const opened = await openCreatorGrantInner(inner, 'vault passphrase', grant.kdfSalt, 'vault-1', 'user-1');
    const text = await encryptText(vaultKey, 'Holidays', aad.vaultLabel('vault-1'));
    expect(await decryptText(opened!, text.encrypted, text.nonce, aad.vaultLabel('vault-1'))).toBe('Holidays');
  });

  it('the same passphrase on two vaults gives unrelated grants', async () => {
    const me = await generateIdentity();
    const a = await wrapCreatorGrant(await generateScopeKey(), 'shared passphrase', 'a', 'u', me.encPk);
    const b = await wrapCreatorGrant(await generateScopeKey(), 'shared passphrase', 'b', 'u', me.encPk);
    expect(a.kdfSalt).not.toBe(b.kdfSalt);
    const enc = await importEncPrivate(me.encSk);
    const innerA = await openCreatorGrantOuter(enc, me.encPk, a, 'a', 'u');
    expect(await openCreatorGrantInner(innerA, 'shared passphrase', b.kdfSalt, 'a', 'u')).toBeNull();
  });

  it('never hands out the passphrase key bytes', async () => {
    const key = await derivePassphraseKey('passphrase', b64encode(randomBytes(16)));
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('shares a vault key so only the recipient can open it', async () => {
    const recipient = await generateIdentity();
    const stranger = await generateIdentity();
    const vaultKey = await generateScopeKey();
    const purpose = aad.vaultKey('vault-1', 'recipient');
    const sealed = await sealScopeKey(vaultKey, recipient.encPk, purpose);

    const opened = await openScopeKey(await importEncPrivate(recipient.encSk), recipient.encPk, sealed, purpose);
    const text = await encryptText(vaultKey, 'label', aad.vaultLabel('vault-1'));
    expect(await decryptText(opened, text.encrypted, text.nonce, aad.vaultLabel('vault-1'))).toBe('label');

    await expect(
      openScopeKey(await importEncPrivate(stranger.encSk), stranger.encPk, sealed, purpose),
    ).rejects.toThrow();
    // A grant replayed onto another user's row does not open
    await expect(
      openScopeKey(await importEncPrivate(recipient.encSk), recipient.encPk, sealed, aad.vaultKey('vault-1', 'other')),
    ).rejects.toThrow();
  });
});

describe('media keys', () => {
  it('wraps a fresh key that only its vault key and ids can unwrap', async () => {
    const vaultKey = await generateScopeKey();
    const otherVault = await generateScopeKey();
    const mediaKey = await generateMediaKey();
    const wrapped = await wrapKey(vaultKey, mediaKey, aad.mediaKeyVault('m1', 'v1'));

    const iv = randomBytes(12);
    const plaintext = randomBytes(5000);
    const ciphertext = await gcmEncrypt(mediaKey, iv, plaintext, aad.mediaBlob('m1', 'original'));
    expect(ciphertext).toHaveLength(plaintext.length + 16);

    const unwrapped = await unwrapKey(vaultKey, wrapped, aad.mediaKeyVault('m1', 'v1'), ['decrypt'], false);
    expect(unwrapped.extractable).toBe(false);
    expect(await gcmDecrypt(unwrapped, iv, ciphertext, aad.mediaBlob('m1', 'original'))).toEqual(plaintext);

    await expect(unwrapKey(otherVault, wrapped, aad.mediaKeyVault('m1', 'v1'), ['decrypt'], false)).rejects.toThrow();
    // The server cannot attach this wrapped key to another item, or pass one tier off as another
    await expect(unwrapKey(vaultKey, wrapped, aad.mediaKeyVault('m2', 'v1'), ['decrypt'], false)).rejects.toThrow();
    await expect(gcmDecrypt(unwrapped, iv, ciphertext, aad.mediaBlob('m1', 'thumb'))).rejects.toThrow();
    await expect(gcmDecrypt(unwrapped, iv, ciphertext, aad.mediaBlob('m2', 'original'))).rejects.toThrow();
  });

  it('reaches a file through its album when there is no vault wrap', async () => {
    const vaultKey = await generateScopeKey();
    const albumKey = await generateScopeKey();
    const mediaKey = await generateMediaKey();
    const albumWrapped = await wrapKey(vaultKey, albumKey, aad.albumKey('a1', 'v1'));
    const mediaWrapped = await wrapKey(albumKey, mediaKey, aad.mediaKeyAlbum('m1', 'a1'));
    const meta = await encryptText(mediaKey, '{"filename":"a.jpg"}', aad.mediaMeta('m1'));

    const viaVault = await unwrapScopeKey(vaultKey, albumWrapped, aad.albumKey('a1', 'v1'));
    const key = await unwrapKey(viaVault, mediaWrapped, aad.mediaKeyAlbum('m1', 'a1'), ['decrypt'], false);
    expect(await decryptText(key, meta.encrypted, meta.nonce, aad.mediaMeta('m1'))).toBe('{"filename":"a.jpg"}');
  });

  it('detects tampering', async () => {
    const key = await importAesKey(randomBytes(32), ['encrypt', 'decrypt']);
    const iv = randomBytes(12);
    const ciphertext = await gcmEncrypt(key, iv, utf8Encode('untouched'));
    ciphertext[0]! ^= 1;
    await expect(gcmDecrypt(key, iv, ciphertext)).rejects.toThrow();
  });

  it('round-trips text with a new nonce each time', async () => {
    const key = await importScopeKey(randomBytes(32));
    const first = await encryptText(key, 'Summer 2024 ☀️', aad.albumName('a'));
    const second = await encryptText(key, 'Summer 2024 ☀️', aad.albumName('a'));
    expect(first.nonce).not.toBe(second.nonce);
    expect(await decryptText(key, first.encrypted, first.nonce, aad.albumName('a'))).toBe('Summer 2024 ☀️');
    expect(await decryptText(key, first.encrypted, first.nonce, aad.albumName('b'))).toBeNull();
  });
});

describe('migration CLI compatibility', () => {
  it('reads media encrypted by the CLI, through the vault and through the album', async () => {
    const vaultRaw = randomBytes(32);
    const albumRaw = randomBytes(32);
    const photo = Buffer.from(randomBytes(4096));
    const out = cli.encryptMedia({
      mediaId: 'm1',
      vaultId: 'v1',
      vaultKey: Buffer.from(vaultRaw),
      album: { id: 'a1', key: Buffer.from(albumRaw) },
      thumb: Buffer.from('thumb'),
      preview: Buffer.from('preview'),
      original: photo,
      meta: { filename: 'from-cli.jpg' },
    });

    const vaultKey = await importScopeKey(vaultRaw);
    const albumKey = await importScopeKey(albumRaw);
    for (const key of [
      await unwrapKey(vaultKey, { wrapped: out.keyWrappedVault, nonce: out.keyNonceVault }, aad.mediaKeyVault('m1', 'v1'), ['decrypt'], false),
      await unwrapKey(albumKey, { wrapped: out.keyWrappedAlbum!, nonce: out.keyNonceAlbum! }, aad.mediaKeyAlbum('m1', 'a1'), ['decrypt'], false),
    ]) {
      const plain = await gcmDecrypt(key, new Uint8Array(out.original.iv), new Uint8Array(out.original.encrypted), aad.mediaBlob('m1', 'original'));
      expect(Buffer.from(plain).equals(photo)).toBe(true);
      const meta = await decryptText(key, out.encryptedMeta, out.metaNonce, aad.mediaMeta('m1'));
      expect(JSON.parse(meta!)).toEqual({ filename: 'from-cli.jpg' });
    }
  });

  it('writes vaults and shares the CLI can open', async () => {
    const creator = await generateIdentity();
    const recipient = await generateIdentity();
    const vaultKey = await generateScopeKey();
    const raw = Buffer.from(await crypto.subtle.exportKey('raw', vaultKey));

    const grant = await wrapCreatorGrant(vaultKey, 'made in the browser', 'v1', 'u1', creator.encPk);
    const cliCreator = {
      userId: 'u1',
      encSk: Buffer.from(creator.encSk),
      encPk: Buffer.from(creator.encPk),
      signSk: Buffer.from(creator.signSk),
      ownerSignPk: Buffer.from(creator.signPk),
    };
    const row = { id: 'v1', role: 'creator' as const, permission: 'write' as const, ...grant, grantSig: null, granter: null };
    expect((await cli.openCreatorVaultKey(row, 'made in the browser', cliCreator))?.equals(raw)).toBe(true);
    expect(await cli.openCreatorVaultKey(row, 'not the passphrase', cliCreator)).toBeNull();

    // Shared by the creator (who is also the server owner here) with a certified recipient
    const creatorSign = await importSignPrivate(creator.signSk);
    const creatorKeys = { userId: 'u1', username: 'creator', publicEncKey: b64encode(creator.encPk), publicSignKey: b64encode(creator.signPk) };
    const granter = { ...creatorKeys, keyCert: await signCert(creatorSign, creatorKeys) };
    const sealed = await sealScopeKey(vaultKey, recipient.encPk, aad.vaultKey('v1', 'u2'));
    const shared = {
      id: 'v1',
      role: 'member' as const,
      permission: 'view' as const,
      wrappedKey: b64encode(sealed),
      kdfSalt: null,
      grantSig: await signGrant(creatorSign, 'vault', 'v1', 'u2', 'u1', sealed),
      granter,
    };
    const cliRecipient = {
      userId: 'u2',
      encSk: Buffer.from(recipient.encSk),
      encPk: Buffer.from(recipient.encPk),
      signSk: Buffer.from(recipient.signSk),
      ownerSignPk: Buffer.from(creator.signPk),
    };
    expect(cli.openSharedVaultKey(shared, cliRecipient).equals(raw)).toBe(true);
  });
});
