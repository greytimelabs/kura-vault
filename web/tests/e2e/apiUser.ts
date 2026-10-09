// A complete client without a browser: the real key handling (the same Keyring
// the worker runs) talking to the real API. Used to create accounts for the
// browser tests and to test the server's rules directly.
import { Keyring } from '../../src/lib/crypto/keyring';
import { b64decode, b64encode } from '../../src/lib/crypto/base64';
import { inviteAuthToken, type UserKeys } from '../../src/lib/crypto/identity';
import type { MediaKeyRef, OwnVault, SharedAlbum, SharedVault } from '../../src/lib/crypto/protocol';
import { decodeInviteLink, encodeInviteLink, type InviteLink } from '../../src/lib/invite';
import { API_URL } from './env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`${status} ${message}`);
  }
}

export interface Credentials {
  username: string;
  password: string;
  passphrase: string;
}

interface VaultRow extends OwnVault, SharedVault {
  role: 'creator' | 'member';
  permission: 'view' | 'write';
  kdfSalt: string;
}

export interface MediaRow {
  id: string;
  vaultId: string;
  thumbIv: string;
  key: { scope: 'vault' | 'album'; albumId: string | null; wrapped: string; nonce: string } | null;
  encryptedMeta: string | null;
  metaNonce: string | null;
  isLiked: boolean;
}

export async function api<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = (await response.json().catch(() => null)) as { data?: T; message?: string | string[] } | null;
  if (!response.ok) {
    const message = Array.isArray(json?.message) ? json.message.join('; ') : (json?.message ?? response.statusText);
    throw new ApiError(response.status, message);
  }
  return json?.data as T;
}

export class ApiUser {
  readonly keyring = new Keyring();
  token: string | null = null;
  refreshToken: string | null = null;
  id = '';
  keys!: UserKeys;

  private constructor(readonly credentials: Credentials) {}

  call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return api<T>(method, path, { body, token: this.token });
  }

  /** Create the server's owner account with the setup key. */
  static async setup(setupKey: string, credentials: Credentials): Promise<ApiUser> {
    const user = new ApiUser(credentials);
    const id = crypto.randomUUID();
    const material = await user.keyring.createAccount({
      userId: id,
      username: credentials.username,
      passphrase: credentials.passphrase,
    });
    const { keyBinding: _unused, ...keys } = material;
    await api('POST', '/setup', {
      body: { setupKey, id, username: credentials.username, password: credentials.password, ...keys },
    });
    await user.signIn();
    return user;
  }

  /** Sign in to an existing account and unlock it. */
  static async signIn(credentials: Credentials): Promise<ApiUser> {
    const user = new ApiUser(credentials);
    await user.signIn();
    if (!(await user.unlock())) throw new Error('Wrong master passphrase');
    return user;
  }

  /** Accept an invite link the way the Join page does. */
  static async join(link: string, password: string, passphrase: string): Promise<ApiUser> {
    const invite = decodeInviteLink(link);
    const token = b64encode(await inviteAuthToken(b64decode(invite.secret)));
    const info = await api<{ userId: string; username: string; ownerPublicSignKey: string }>(
      'GET',
      `/invites/${invite.inviteId}`,
      { headers: { 'X-Invite-Token': token } },
    );
    if (info.ownerPublicSignKey !== invite.ownerSignKey) throw new Error('Server owner key does not match the link');

    const user = new ApiUser({ username: info.username, password, passphrase });
    const material = await user.keyring.createAccount({
      userId: info.userId,
      username: info.username,
      passphrase,
      invite: { secret: invite.secret, ownerSignKey: invite.ownerSignKey },
    });
    const { keyCert: _unused, ...keys } = material;
    await api('POST', `/invites/${invite.inviteId}/accept`, { body: { token, password, ...keys } });
    await user.signIn();
    return user;
  }

  async signIn(): Promise<void> {
    const result = await api<{ accessToken: string; refreshToken: string; user: { id: string } }>(
      'POST',
      '/auth/login',
      { body: { username: this.credentials.username, password: this.credentials.password } },
    );
    this.token = result.accessToken;
    this.refreshToken = result.refreshToken;
    this.id = result.user.id;
    await this.loadKeys();
  }

  private async loadKeys(): Promise<Record<string, string>> {
    const me = await this.call<Record<string, string>>('GET', '/me');
    this.keys = {
      userId: me.id!,
      username: me.username!,
      publicEncKey: me.publicEncKey!,
      publicSignKey: me.publicSignKey!,
      keyCert: me.keyCert ?? null,
    };
    return me;
  }

  /** Load this account's keys into a fresh keyring, as after a page reload. */
  async unlock(passphrase = this.credentials.passphrase): Promise<boolean> {
    const me = await this.loadKeys();
    return this.keyring.unlockAccount({
      account: {
        id: me.id!,
        kdfSalt: me.kdfSalt!,
        encryptedPrivateKeys: me.encryptedPrivateKeys!,
        privateKeysNonce: me.privateKeysNonce!,
        publicEncKey: me.publicEncKey!,
        publicSignKey: me.publicSignKey!,
      },
      passphrase,
    });
  }

  // ── Owner ──

  async invite(username: string, accessLevel: 'full' | 'limited'): Promise<{ link: string; userId: string; invite: InviteLink }> {
    const inviteId = crypto.randomUUID();
    const material = await this.keyring.createInvite({ inviteId });
    const created = await this.call<{ userId: string }>('POST', '/users/invites', {
      id: inviteId,
      username,
      accessLevel,
      tokenHash: material.tokenHash,
      ownerSecretEncrypted: material.ownerSecretEncrypted,
    });
    const invite: InviteLink = { server: null, inviteId, secret: material.secret, ownerSignKey: material.ownerSignKey };
    return { link: encodeInviteLink('http://localhost', invite), userId: created.userId, invite };
  }

  /** Verify and sign every user who joined since last time. Returns the usernames that failed verification. */
  async certifyPending(): Promise<string[]> {
    const { users } = await this.call<{
      users: (UserKeys & { verification: { inviteId: string; ownerSecretEncrypted: string; keyBinding: string } | null })[];
    }>('GET', '/users');
    const rejected: string[] = [];
    for (const user of users) {
      if (!user.verification) continue;
      const { verification, ...keys } = user;
      const keyCert = await this.keyring.certifyUser({ user: keys, verification });
      if (keyCert) await this.call('PUT', `/users/${user.userId}/cert`, { keyCert });
      else rejected.push(user.username);
    }
    return rejected;
  }

  // ── Vaults ──

  vaults(): Promise<VaultRow[]> {
    return this.call<VaultRow[]>('GET', '/vaults');
  }

  async createVault(passphrase: string, label: string): Promise<string> {
    const vault = await this.keyring.createVault({ passphrase, label });
    await this.call('POST', '/vaults', {
      id: vault.id,
      wrappedKey: vault.wrappedKey,
      kdfSalt: vault.kdfSalt,
      ...(vault.labelEncrypted ? { labelEncrypted: vault.labelEncrypted, labelNonce: vault.labelNonce } : {}),
    });
    this.keyring.selectVault({ vaultId: vault.id });
    return vault.id;
  }

  /** Enter a vault passphrase: returns the labels of the own vaults it opens. */
  async openOwnVaults(passphrase: string): Promise<string[]> {
    const own = (await this.vaults()).filter((v) => v.role === 'creator');
    const matches = await this.keyring.findMatches({ passphrase, vaults: own });
    for (const match of matches) {
      // findMatches keeps candidates until one is selected; select each in turn
      await this.keyring.findMatches({ passphrase, vaults: own.filter((v) => v.id === match.vaultId) });
      this.keyring.selectVault({ vaultId: match.vaultId });
    }
    return matches.map((m) => m.label);
  }

  /** Open everything shared with this account. Returns labels, null where a share failed verification. */
  async openSharedVaults(): Promise<(string | null)[]> {
    const shared = (await this.vaults()).filter((v) => v.role === 'member');
    return this.keyring.openSharedVaults({ vaults: shared });
  }

  async directory(): Promise<UserKeys[]> {
    return this.call<UserKeys[]>('GET', '/users/directory');
  }

  async shareVault(vaultId: string, recipient: UserKeys, permission: 'view' | 'write'): Promise<void> {
    const grant = await this.keyring.shareVault({ vaultId, recipient });
    await this.call('POST', `/vaults/${vaultId}/members`, { userId: recipient.userId, permission, ...grant });
  }

  // ── Albums ──

  async createAlbum(vaultId: string, name: string): Promise<string> {
    const album = await this.keyring.createAlbum({ vaultId, name });
    await this.call('POST', '/albums', { vaultId, ...album });
    return album.id;
  }

  /** Load a vault's album keys and return the album names by id. */
  async openAlbums(vaultId: string): Promise<Map<string, string | null>> {
    const albums = await this.call<
      { id: string; kind: string; keyWrapped: string | null; keyNonce: string | null; nameEncrypted: string | null; nameNonce: string | null }[]
    >('GET', `/albums?vaultId=${vaultId}`);
    const names = await this.keyring.openAlbums({ vaultId, albums });
    return new Map(albums.map((a, i) => [a.id, names[i]!]));
  }

  async sharedAlbums(): Promise<(SharedAlbum & { vaultId: string; permission: string })[]> {
    return this.call('GET', '/albums/shared');
  }

  async openSharedAlbums(): Promise<(string | null)[]> {
    return this.keyring.openSharedAlbums({ albums: await this.sharedAlbums() });
  }

  async shareAlbum(albumId: string, recipient: UserKeys, permission: 'view' | 'write'): Promise<void> {
    const grant = await this.keyring.shareAlbum({ albumId, recipient });
    await this.call('POST', `/albums/${albumId}/members`, { userId: recipient.userId, permission, ...grant });
  }

  // ── Media ──

  /** Encrypt and register one item. The blobs are returned instead of uploaded: these tests have no storage. */
  async upload(vaultId: string, filename: string, albumId?: string): Promise<{ id: string; thumb: ArrayBuffer }> {
    const { mediaId } = await this.call<{ mediaId: string }>('POST', '/media/upload/init', {
      vaultId,
      mediaType: 'photo',
      ...(albumId ? { albumId } : {}),
    });
    const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
    const encrypted = await this.keyring.encryptMedia({
      mediaId,
      vaultId,
      albumId,
      thumb: bytes(`thumb of ${filename}`),
      preview: bytes(`preview of ${filename}`),
      original: bytes(`original of ${filename}`),
      meta: { filename },
    });
    await this.call('POST', '/media/upload/complete', {
      mediaId,
      vaultId,
      ...(albumId ? { albumId } : {}),
      mediaType: 'photo',
      capturedAt: new Date().toISOString(),
      ...(encrypted.vaultKey ? { keyWrappedVault: encrypted.vaultKey.wrapped, keyNonceVault: encrypted.vaultKey.nonce } : {}),
      ...(encrypted.albumKey ? { keyWrappedAlbum: encrypted.albumKey.wrapped, keyNonceAlbum: encrypted.albumKey.nonce } : {}),
      thumbIv: encrypted.thumb.iv,
      previewIv: encrypted.preview.iv,
      originalIv: encrypted.original.iv,
      encryptedMeta: encrypted.encryptedMeta,
      metaNonce: encrypted.metaNonce,
    });
    return { id: mediaId, thumb: encrypted.thumb.data };
  }

  async listMedia(query: { vaultId?: string; albumId?: string }): Promise<MediaRow[]> {
    const params = new URLSearchParams(query as Record<string, string>);
    return (await this.call<{ data: MediaRow[] }>('GET', `/media?${params}`)).data;
  }

  keyRef(row: MediaRow): MediaKeyRef | null {
    return row.key ? { ...row.key, vaultId: row.vaultId } : null;
  }

  /** The decrypted filename of each listed item, null where this account cannot decrypt it. */
  async filenames(rows: MediaRow[]): Promise<(string | null)[]> {
    const metas = await this.keyring.decryptMetas({
      items: rows.map((row) => ({
        mediaId: row.id,
        key: this.keyRef(row),
        encrypted: row.encryptedMeta,
        nonce: row.metaNonce,
      })),
    });
    return metas.map((meta) => (meta ? (JSON.parse(meta) as { filename: string }).filename : null));
  }
}
