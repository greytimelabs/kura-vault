// Every key this client holds, and everything that can be done with them. In the
// browser one Keyring lives inside crypto.worker.ts and nowhere else; its methods
// take and return only ciphertext, public keys and decrypted content, never key
// bytes (the one exception is an invite's secret, which exists to be put in a link).
import { aad, type Tier } from './aad';
import { IV_LENGTH, gcmDecrypt, gcmEncrypt, randomBytes, zero } from './aesgcm';
import { b64decode, b64encode, hexEncode } from './base64';
import {
  INVITE_SECRET_LENGTH,
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
  sha256,
  signCert,
  signGrant,
  signPublicOf,
  verifyCert,
  verifyGrant,
  type UserKeys,
} from './identity';
import type {
  AccountKeys,
  AccountMaterial,
  AlbumKeyInfo,
  EncryptedMedia,
  EncryptedTier,
  InviteMaterial,
  MediaKeyRef,
  NewAlbum,
  NewVault,
  OwnVault,
  ShareGrant,
  SharedAlbum,
  SharedVault,
  VaultMatch,
} from './protocol';
import {
  decryptText,
  derivePassphraseKey,
  encryptText,
  generateMediaKey,
  generateScopeKey,
  newSalt,
  openCreatorGrantInner,
  openCreatorGrantOuter,
  openScopeKey,
  sealScopeKey,
  unwrapKey,
  unwrapScopeKey,
  wrapCreatorGrant,
  wrapKey,
  type EncryptedText,
  type WrappedKey,
} from './vaultCrypto';

const MEDIA_KEY_CACHE_SIZE = 400;

interface Identity {
  userId: string;
  encPrivate: CryptoKey;
  signPrivate: CryptoKey;
  encPk: Uint8Array<ArrayBuffer>;
  signPk: Uint8Array<ArrayBuffer>;
  /** The trust root: other users' keys count only when certified by this key. */
  ownerSignPk: Uint8Array<ArrayBuffer>;
}

export class KeyringLockedError extends Error {
  constructor(message = 'Locked') {
    super(message);
    this.name = 'KeyringLockedError';
  }
}

export class Keyring {
  private identity: Identity | null = null;
  private readonly vaultKeys = new Map<string, CryptoKey>();
  /** Own vaults whose passphrase matched but which are not opened yet. */
  private readonly candidates = new Map<string, CryptoKey>();
  private readonly albumKeys = new Map<string, CryptoKey>();
  /** Which vault an album key was reached through, so closing the vault drops it. */
  private readonly albumVault = new Map<string, string>();
  /** Unwrapped media keys, so a photo's thumbnail and preview do not unwrap twice. */
  private readonly mediaKeys = new Map<string, CryptoKey>();

  private me(): Identity {
    if (!this.identity) throw new KeyringLockedError('Account is locked');
    return this.identity;
  }

  private vaultKey(vaultId: string): CryptoKey {
    const key = this.vaultKeys.get(vaultId);
    if (!key) throw new KeyringLockedError('Vault is locked');
    return key;
  }

  private albumKey(albumId: string): CryptoKey {
    const key = this.albumKeys.get(albumId);
    if (!key) throw new KeyringLockedError('Album key is not loaded');
    return key;
  }

  // ── Account ──

  /**
   * Generate a new user's keys and encrypt the private half under the master
   * passphrase. Without `invite` this is the server owner, who certifies
   * themselves; with it, the new user proves their keys to the owner through
   * the link's secret and takes the owner's key from the link as their trust root.
   */
  async createAccount(args: {
    userId: string;
    username: string;
    passphrase: string;
    invite?: { secret: string; ownerSignKey: string };
  }): Promise<AccountMaterial> {
    const raw = await generateIdentity();
    try {
      const ownerSignPk = args.invite ? b64decode(args.invite.ownerSignKey) : raw.signPk;
      const kdfSalt = newSalt();
      const masterKey = await derivePassphraseKey(args.passphrase, kdfSalt);
      const bundle = await encryptBundle(masterKey, args.userId, {
        encSk: raw.encSk,
        signSk: raw.signSk,
        ownerSignPk,
      });

      this.identity = {
        userId: args.userId,
        encPrivate: await importEncPrivate(raw.encSk),
        signPrivate: await importSignPrivate(raw.signSk),
        encPk: raw.encPk,
        signPk: raw.signPk,
        ownerSignPk,
      };

      const keys = {
        userId: args.userId,
        username: args.username,
        publicEncKey: b64encode(raw.encPk),
        publicSignKey: b64encode(raw.signPk),
      };
      return {
        kdfSalt,
        encryptedPrivateKeys: bundle.encrypted,
        privateKeysNonce: bundle.nonce,
        publicEncKey: keys.publicEncKey,
        publicSignKey: keys.publicSignKey,
        keyCert: args.invite ? null : await signCert(this.identity.signPrivate, keys),
        keyBinding: args.invite ? b64encode(await inviteBinding(b64decode(args.invite.secret), keys)) : null,
      };
    } finally {
      zero(raw.encSk);
      zero(raw.signSk);
    }
  }

  /**
   * Load the account's private keys with the master passphrase. False means a
   * wrong passphrase. Throws when the public keys the server reports are not
   * the ones these private keys belong to: others would be sealing to a key
   * this user cannot open, or to someone else's.
   */
  async unlockAccount(args: { account: AccountKeys; passphrase: string }): Promise<boolean> {
    const { account } = args;
    let bundle;
    try {
      const masterKey = await derivePassphraseKey(args.passphrase, account.kdfSalt);
      bundle = await decryptBundle(masterKey, account.id, account.encryptedPrivateKeys, account.privateKeysNonce);
    } catch {
      return false;
    }
    try {
      const encPk = await encPublicOf(bundle.encSk);
      const signPk = await signPublicOf(bundle.signSk);
      if (b64encode(encPk) !== account.publicEncKey || b64encode(signPk) !== account.publicSignKey) {
        throw new Error('The server reports keys that are not yours. Do not continue; contact the server owner.');
      }
      this.lock();
      this.identity = {
        userId: account.id,
        encPrivate: await importEncPrivate(bundle.encSk),
        signPrivate: await importSignPrivate(bundle.signSk),
        encPk,
        signPk,
        ownerSignPk: bundle.ownerSignPk,
      };
      return true;
    } finally {
      zero(bundle.encSk);
      zero(bundle.signSk);
    }
  }

  /** Re-encrypt the same private keys under a new master passphrase. Null when the current one is wrong. */
  async changePassphrase(args: {
    account: AccountKeys;
    passphrase: string;
    newPassphrase: string;
  }): Promise<Pick<AccountMaterial, 'kdfSalt' | 'encryptedPrivateKeys' | 'privateKeysNonce'> | null> {
    const { account } = args;
    let bundle;
    try {
      const masterKey = await derivePassphraseKey(args.passphrase, account.kdfSalt);
      bundle = await decryptBundle(masterKey, account.id, account.encryptedPrivateKeys, account.privateKeysNonce);
    } catch {
      return null;
    }
    try {
      const kdfSalt = newSalt();
      const next = await encryptBundle(await derivePassphraseKey(args.newPassphrase, kdfSalt), account.id, bundle);
      return { kdfSalt, encryptedPrivateKeys: next.encrypted, privateKeysNonce: next.nonce };
    } finally {
      zero(bundle.encSk);
      zero(bundle.signSk);
    }
  }

  isUnlocked(): boolean {
    return this.identity !== null;
  }

  /** True when the owner this account trusts is the account itself. */
  isTrustRoot(): boolean {
    const me = this.me();
    return equalBytes(me.signPk, me.ownerSignPk);
  }

  /** The owner signing key this account trusts, to compare with what a server claims. */
  trustedOwnerKey(): string {
    return b64encode(this.me().ownerSignPk);
  }

  /** Forget every key. */
  lock(): void {
    this.identity = null;
    this.vaultKeys.clear();
    this.candidates.clear();
    this.albumKeys.clear();
    this.albumVault.clear();
    this.mediaKeys.clear();
  }

  // ── Users (owner) ──

  /**
   * Start an invitation. The secret goes into the link and nowhere else: the
   * server gets a hash of a token derived from it, and a copy sealed to the
   * owner so their client can check the invitee's keys later.
   */
  async createInvite(args: { inviteId: string }): Promise<InviteMaterial> {
    const me = this.me();
    const secret = randomBytes(INVITE_SECRET_LENGTH);
    try {
      const token = await inviteAuthToken(secret);
      return {
        secret: b64encode(secret),
        tokenHash: hexEncode(await sha256(token)),
        ownerSecretEncrypted: b64encode(await seal(me.encPk, secret, aad.inviteSecret(args.inviteId))),
        ownerSignKey: b64encode(me.signPk),
      };
    } finally {
      zero(secret);
    }
  }

  /**
   * Sign a new user's keys, but only if they are the keys the invitee bound
   * with the link's secret. Null means they are not: the server (or someone on
   * the path) replaced them, and nothing must be shared with that account.
   */
  async certifyUser(args: {
    user: Omit<UserKeys, 'keyCert'>;
    verification: { inviteId: string; ownerSecretEncrypted: string; keyBinding: string };
  }): Promise<string | null> {
    const me = this.me();
    let secret;
    try {
      secret = await open(
        me.encPrivate,
        me.encPk,
        b64decode(args.verification.ownerSecretEncrypted),
        aad.inviteSecret(args.verification.inviteId),
      );
    } catch {
      return null;
    }
    try {
      const expected = await inviteBinding(secret, args.user);
      let presented;
      try {
        presented = b64decode(args.verification.keyBinding);
      } catch {
        return null;
      }
      if (!equalBytes(expected, presented)) return null;
      return await signCert(me.signPrivate, args.user);
    } finally {
      zero(secret);
    }
  }

  /** True when the owner this account trusts certified exactly these keys for this user. */
  verifyUser(args: { user: UserKeys }): Promise<boolean> {
    return verifyCert(this.me().ownerSignPk, args.user);
  }

  private async requireVerified(user: UserKeys): Promise<void> {
    if (!(await this.verifyUser({ user }))) {
      throw new Error(`The keys for ${user.username} could not be verified. Nothing was shared.`);
    }
  }

  // ── Vaults ──

  /** The new vault's key stays here as a candidate so the caller can open it straight away. */
  async createVault(args: { passphrase: string; label: string }): Promise<NewVault> {
    const me = this.me();
    const id = crypto.randomUUID();
    const key = await generateScopeKey();
    const grant = await wrapCreatorGrant(key, args.passphrase, id, me.userId, me.encPk);
    const label = args.label.trim();
    const encLabel = label ? await encryptText(key, label, aad.vaultLabel(id)) : null;
    this.candidates.set(id, key);
    return {
      id,
      wrappedKey: grant.wrappedKey,
      kdfSalt: grant.kdfSalt,
      labelEncrypted: encLabel?.encrypted ?? null,
      labelNonce: encLabel?.nonce ?? null,
    };
  }

  /**
   * Try the passphrase against EVERY vault the user created. Each has its own
   * salt, so one passphrase can legitimately open more than one. There is no
   * early exit: the time taken must not reveal which vault matched, or how many did.
   */
  async findMatches(args: { passphrase: string; vaults: OwnVault[] }): Promise<VaultMatch[]> {
    const me = this.me();
    this.candidates.clear();
    const matches: VaultMatch[] = [];
    for (const vault of args.vaults) {
      let key: CryptoKey | null = null;
      try {
        const inner = await openCreatorGrantOuter(me.encPrivate, me.encPk, vault, vault.id, me.userId);
        key = await openCreatorGrantInner(inner, args.passphrase, vault.kdfSalt, vault.id, me.userId);
      } catch {
        // not sealed to this account: this vault can never match
      }
      if (key) {
        const label = (await decryptText(key, vault.labelEncrypted, vault.labelNonce, aad.vaultLabel(vault.id)))?.trim();
        this.candidates.set(vault.id, key);
        matches.push({ vaultId: vault.id, label: label || `Vault ${matches.length + 1}` });
      }
    }
    return matches;
  }

  /** Commit one match as an open vault. The keys of the other matches are dropped. */
  selectVault(args: { vaultId: string }): void {
    const key = this.candidates.get(args.vaultId);
    if (!key) throw new Error('Unknown vault');
    this.vaultKeys.set(args.vaultId, key);
    this.candidates.clear();
  }

  discardMatches(): void {
    this.candidates.clear();
  }

  /**
   * Open the vaults other people shared with this account. A share is used only
   * if its sender's keys are certified and they signed this exact sealed key;
   * anything else (a key the server made up, say) is skipped and reported as null.
   */
  async openSharedVaults(args: { vaults: SharedVault[] }): Promise<(string | null)[]> {
    const me = this.me();
    const labels: (string | null)[] = [];
    for (const vault of args.vaults) {
      try {
        const sealed = b64decode(vault.wrappedKey);
        await this.requireGrant('vault', vault.id, vault.granter, vault.grantSig, sealed);
        const key = await openScopeKey(me.encPrivate, me.encPk, sealed, aad.vaultKey(vault.id, me.userId));
        this.vaultKeys.set(vault.id, key);
        const label = await decryptText(key, vault.labelEncrypted, vault.labelNonce, aad.vaultLabel(vault.id));
        labels.push(label?.trim() || 'Shared vault');
      } catch {
        labels.push(null);
      }
    }
    return labels;
  }

  private async requireGrant(
    kind: 'vault' | 'album',
    resourceId: string,
    granter: UserKeys | null,
    signature: string | null,
    sealed: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    const me = this.me();
    if (!granter || !signature) throw new Error('Unsigned share');
    if (!(await verifyCert(me.ownerSignPk, granter))) throw new Error('Unverified sharer');
    const ok = await verifyGrant(
      b64decode(granter.publicSignKey),
      signature,
      kind,
      resourceId,
      me.userId,
      granter.userId,
      sealed,
    );
    if (!ok) throw new Error('Share was not issued by its stated sender');
  }

  /** Forget one vault's key and everything reached through it. */
  closeVault(args: { vaultId: string }): void {
    this.vaultKeys.delete(args.vaultId);
    for (const [albumId, vaultId] of this.albumVault) {
      if (vaultId === args.vaultId) {
        this.albumKeys.delete(albumId);
        this.albumVault.delete(albumId);
      }
    }
    this.mediaKeys.clear();
  }

  /** Seal an open vault's key to another user, after checking the owner certified their keys. */
  async shareVault(args: { vaultId: string; recipient: UserKeys }): Promise<ShareGrant> {
    const me = this.me();
    const key = this.vaultKey(args.vaultId);
    await this.requireVerified(args.recipient);
    const sealed = await sealScopeKey(
      key,
      b64decode(args.recipient.publicEncKey),
      aad.vaultKey(args.vaultId, args.recipient.userId),
    );
    return {
      wrappedKey: b64encode(sealed),
      grantSig: await signGrant(me.signPrivate, 'vault', args.vaultId, args.recipient.userId, me.userId, sealed),
    };
  }

  // ── Albums ──

  async createAlbum(args: { vaultId: string; name: string }): Promise<NewAlbum> {
    const vaultKey = this.vaultKey(args.vaultId);
    const id = crypto.randomUUID();
    const key = await generateScopeKey();
    const wrapped = await wrapKey(vaultKey, key, aad.albumKey(id, args.vaultId));
    const name = await encryptText(key, args.name, aad.albumName(id));
    this.albumKeys.set(id, key);
    this.albumVault.set(id, args.vaultId);
    return {
      id,
      keyWrapped: wrapped.wrapped,
      keyNonce: wrapped.nonce,
      nameEncrypted: name.encrypted,
      nameNonce: name.nonce,
    };
  }

  /** Load the keys of a vault's albums through the vault key and return their names. Null for an album with no key (Liked). */
  async openAlbums(args: { vaultId: string; albums: AlbumKeyInfo[] }): Promise<(string | null)[]> {
    const vaultKey = this.vaultKey(args.vaultId);
    return Promise.all(
      args.albums.map(async (album) => {
        if (!album.keyWrapped || !album.keyNonce) return null;
        try {
          let key = this.albumKeys.get(album.id);
          if (!key) {
            key = await unwrapScopeKey(
              vaultKey,
              { wrapped: album.keyWrapped, nonce: album.keyNonce },
              aad.albumKey(album.id, args.vaultId),
            );
            this.albumKeys.set(album.id, key);
          }
          this.albumVault.set(album.id, args.vaultId);
          return await decryptText(key, album.nameEncrypted, album.nameNonce, aad.albumName(album.id));
        } catch {
          return null;
        }
      }),
    );
  }

  /** Open albums shared with this account on their own. Null where the share does not verify. */
  async openSharedAlbums(args: { albums: SharedAlbum[] }): Promise<(string | null)[]> {
    const me = this.me();
    const names: (string | null)[] = [];
    for (const album of args.albums) {
      try {
        const sealed = b64decode(album.wrappedKey);
        await this.requireGrant('album', album.id, album.granter, album.grantSig, sealed);
        const key = await openScopeKey(me.encPrivate, me.encPk, sealed, aad.albumKeyGrant(album.id, me.userId));
        this.albumKeys.set(album.id, key);
        const name = await decryptText(key, album.nameEncrypted, album.nameNonce, aad.albumName(album.id));
        names.push(name ?? 'Shared album');
      } catch {
        names.push(null);
      }
    }
    return names;
  }

  encryptAlbumName(args: { albumId: string; name: string }): Promise<EncryptedText> {
    return encryptText(this.albumKey(args.albumId), args.name, aad.albumName(args.albumId));
  }

  async shareAlbum(args: { albumId: string; recipient: UserKeys }): Promise<ShareGrant> {
    const me = this.me();
    const key = this.albumKey(args.albumId);
    await this.requireVerified(args.recipient);
    const sealed = await sealScopeKey(
      key,
      b64decode(args.recipient.publicEncKey),
      aad.albumKeyGrant(args.albumId, args.recipient.userId),
    );
    return {
      wrappedKey: b64encode(sealed),
      grantSig: await signGrant(me.signPrivate, 'album', args.albumId, args.recipient.userId, me.userId, sealed),
    };
  }

  // ── Media ──

  private async mediaKey(mediaId: string, ref: MediaKeyRef, extractable = false): Promise<CryptoKey> {
    const cacheKey = `${mediaId}:${ref.wrapped}`;
    if (!extractable) {
      const cached = this.mediaKeys.get(cacheKey);
      if (cached) {
        this.mediaKeys.delete(cacheKey);
        this.mediaKeys.set(cacheKey, cached);
        return cached;
      }
    }
    const wrapped: WrappedKey = { wrapped: ref.wrapped, nonce: ref.nonce };
    const key =
      ref.scope === 'vault'
        ? await unwrapKey(
            this.vaultKey(ref.vaultId),
            wrapped,
            aad.mediaKeyVault(mediaId, ref.vaultId),
            ['encrypt', 'decrypt'],
            extractable,
          )
        : await unwrapKey(
            this.albumKey(ref.albumId!),
            wrapped,
            aad.mediaKeyAlbum(mediaId, ref.albumId!),
            ['encrypt', 'decrypt'],
            extractable,
          );
    if (!extractable) {
      this.mediaKeys.set(cacheKey, key);
      if (this.mediaKeys.size > MEDIA_KEY_CACHE_SIZE) {
        this.mediaKeys.delete(this.mediaKeys.keys().next().value!);
      }
    }
    return key;
  }

  /**
   * One fresh key per file; the three tiers and the metadata share it, each
   * with its own IV. The key is wrapped under the vault key when this account
   * holds it, and under the album key when the upload goes into an album.
   */
  async encryptMedia(args: {
    mediaId: string;
    vaultId: string;
    albumId?: string | null;
    thumb: ArrayBuffer;
    preview: ArrayBuffer;
    original: ArrayBuffer;
    meta: Record<string, unknown>;
  }): Promise<EncryptedMedia> {
    const vaultKey = this.vaultKeys.get(args.vaultId) ?? null;
    const albumKey = args.albumId ? this.albumKey(args.albumId) : null;
    if (!vaultKey && !albumKey) throw new KeyringLockedError('Vault is locked');

    const key = await generateMediaKey();
    const tier = async (name: Tier, data: ArrayBuffer): Promise<EncryptedTier> => {
      const iv = randomBytes(IV_LENGTH);
      const encrypted = await gcmEncrypt(key, iv, data, aad.mediaBlob(args.mediaId, name));
      return { data: encrypted.buffer, iv: b64encode(iv) };
    };
    const [thumb, preview, original, meta, vaultWrap, albumWrap] = await Promise.all([
      tier('thumb', args.thumb),
      tier('preview', args.preview),
      tier('original', args.original),
      encryptText(key, JSON.stringify(args.meta), aad.mediaMeta(args.mediaId)),
      vaultKey ? wrapKey(vaultKey, key, aad.mediaKeyVault(args.mediaId, args.vaultId)) : null,
      albumKey ? wrapKey(albumKey, key, aad.mediaKeyAlbum(args.mediaId, args.albumId!)) : null,
    ]);
    return {
      vaultKey: vaultWrap,
      albumKey: albumWrap,
      thumb,
      preview,
      original,
      encryptedMeta: meta.encrypted,
      metaNonce: meta.nonce,
    };
  }

  async decryptBlob(args: {
    mediaId: string;
    tier: Tier;
    key: MediaKeyRef;
    iv: string;
    data: ArrayBuffer;
  }): Promise<ArrayBuffer> {
    const key = await this.mediaKey(args.mediaId, args.key);
    return (await gcmDecrypt(key, b64decode(args.iv), args.data, aad.mediaBlob(args.mediaId, args.tier))).buffer;
  }

  /** Null where there is no metadata, no usable key, or it does not verify. */
  async decryptMetas(args: {
    items: { mediaId: string; key: MediaKeyRef | null; encrypted: string | null; nonce: string | null }[];
  }): Promise<(string | null)[]> {
    return Promise.all(
      args.items.map(async (item) => {
        if (!item.key) return null;
        try {
          const key = await this.mediaKey(item.mediaId, item.key);
          return await decryptText(key, item.encrypted, item.nonce, aad.mediaMeta(item.mediaId));
        } catch {
          return null;
        }
      }),
    );
  }

  /**
   * Wrap an existing item's key under another key this account holds: an
   * album's, to put the item in that album, or the vault's, for an item that
   * was uploaded by someone who had only an album.
   */
  async rewrapMediaKey(args: {
    mediaId: string;
    key: MediaKeyRef;
    target: { albumId: string } | { vaultId: string };
  }): Promise<WrappedKey> {
    const key = await this.mediaKey(args.mediaId, args.key, true);
    return 'albumId' in args.target
      ? wrapKey(this.albumKey(args.target.albumId), key, aad.mediaKeyAlbum(args.mediaId, args.target.albumId))
      : wrapKey(this.vaultKey(args.target.vaultId), key, aad.mediaKeyVault(args.mediaId, args.target.vaultId));
  }
}
