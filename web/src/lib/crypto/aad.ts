import { utf8Encode, type Bytes } from './base64';

// Additional data for every AES-GCM operation, and the messages that get signed.
// Each names what the ciphertext is and the rows it belongs to, so the server
// cannot move a wrapped key or a blob to another user, vault, album or item.
// Must stay identical in app/lib/core/crypto/aad.dart and migration-cli/src/encryptor.ts.
const text = (...parts: string[]): Bytes => utf8Encode(`kura/v1/${parts.join('|')}`);

export type Tier = 'thumb' | 'preview' | 'original';

export const aad = {
  userKeys: (userId: string) => text('user-keys', userId),
  inviteSecret: (inviteId: string) => text('invite-secret', inviteId),
  /** Inner, passphrase layer of a creator's vault key. */
  vaultKeyPassphrase: (vaultId: string, userId: string) => text('vault-key-pass', vaultId, userId),
  /** A vault key sealed to a user. */
  vaultKey: (vaultId: string, userId: string) => text('vault-key', vaultId, userId),
  vaultLabel: (vaultId: string) => text('vault-label', vaultId),
  /** An album key wrapped under its vault key. */
  albumKey: (albumId: string, vaultId: string) => text('album-key', albumId, vaultId),
  /** An album key sealed to a user. */
  albumKeyGrant: (albumId: string, userId: string) => text('album-key-grant', albumId, userId),
  albumName: (albumId: string) => text('album-name', albumId),
  mediaKeyVault: (mediaId: string, vaultId: string) => text('media-key', mediaId, 'vault', vaultId),
  mediaKeyAlbum: (mediaId: string, albumId: string) => text('media-key', mediaId, 'album', albumId),
  mediaBlob: (mediaId: string, tier: Tier) => text('media-blob', mediaId, tier),
  mediaMeta: (mediaId: string) => text('media-meta', mediaId),
};

export const signed = {
  /** The owner's statement that these public keys belong to this user. */
  cert: (userId: string, username: string, encPk: string, signPk: string) =>
    text('cert', userId, username, encPk, signPk),
  /** A sharer's statement that they issued this sealed key. `digest` is base64 SHA-256 of the sealed bytes. */
  grant: (kind: 'vault' | 'album', resourceId: string, recipientId: string, granterId: string, digest: string) =>
    text('grant', kind, resourceId, recipientId, granterId, digest),
  /** What an invitee authenticates with the invite secret. */
  binding: (userId: string, username: string, encPk: string, signPk: string) =>
    text('bind', userId, username, encPk, signPk),
};

export const INFO = {
  seal: utf8Encode('kura/seal/v1'),
  inviteAuth: utf8Encode('kura/v1/invite/auth'),
  inviteBind: utf8Encode('kura/v1/invite/bind'),
};
