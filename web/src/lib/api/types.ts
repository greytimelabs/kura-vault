import type { UserKeys } from '../crypto/identity';

export type UserRole = 'owner' | 'member';
/** `full` may create vaults of their own; `limited` only uses what is shared with them. */
export type AccessLevel = 'full' | 'limited';
export type UserStatus = 'active' | 'restricted';
export type SharePermission = 'view' | 'write';

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
  accessLevel: AccessLevel;
}

export interface ServerInfo {
  status: string;
  app?: string;
  apiVersion?: string;
  /** Server release, e.g. 1.2.0; `dev` for an unreleased build */
  version?: string;
  /** True until the server's owner account has been created with the setup key. */
  setupRequired?: boolean;
}

export interface LoginResponse {
  accessToken: string;
  /** In the body only for the multi-server client; otherwise it is set as a cookie. */
  refreshToken?: string;
  expiresIn: string;
  user: SessionUser;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: string;
}

/** The signed-in account, with its private keys as only its master passphrase can open them. */
export interface Me extends SessionUser {
  kdfSalt: string;
  encryptedPrivateKeys: string;
  privateKeysNonce: string;
  publicEncKey: string;
  publicSignKey: string;
  keyCert: string | null;
}

export interface InviteInfo {
  userId: string;
  username: string;
  accessLevel: AccessLevel;
  expiresAt: string;
  ownerPublicSignKey: string;
}

export interface UserRow extends UserKeys {
  role: UserRole;
  accessLevel: AccessLevel;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  /** Present while the owner's client still has to verify this user's keys. */
  verification: { inviteId: string; ownerSecretEncrypted: string; keyBinding: string } | null;
}

export interface PendingInvite {
  id: string;
  username: string;
  accessLevel: AccessLevel;
  expiresAt: string;
  expired: boolean;
}

export interface UserList {
  users: UserRow[];
  invites: PendingInvite[];
}

/** One vault the caller can open, with their wrapped copy of its key. */
export interface VaultRow {
  id: string;
  role: 'creator' | 'member';
  permission: SharePermission;
  wrappedKey: string;
  /** Creator only: salt for the vault passphrase. */
  kdfSalt: string | null;
  grantSig: string | null;
  granter: UserKeys | null;
  labelEncrypted: string | null;
  labelNonce: string | null;
}

export interface Member {
  userId: string;
  username: string;
  role?: 'creator' | 'member';
  permission: SharePermission;
}

export type MediaType = 'photo' | 'video';

/** An item's key as this caller can unwrap it: under the vault key, or under an album's. */
export interface MediaKeyInfo {
  scope: 'vault' | 'album';
  albumId: string | null;
  wrapped: string;
  nonce: string;
}

export interface MediaItem {
  id: string;
  vaultId: string;
  mediaType: MediaType;
  capturedAt: string | null;
  yearMonth: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  durationSeconds: number | null;
  thumbIv: string;
  key: MediaKeyInfo | null;
  encryptedMeta: string | null;
  metaNonce: string | null;
  thumbUrl: string;
  isLiked: boolean;
}

export interface MediaPage {
  data: MediaItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MediaUrls {
  previewUrl: string;
  originalUrl: string;
  previewIv: string;
  originalIv: string;
}

export type AlbumKind = 'regular' | 'liked';

export interface Album {
  id: string;
  vaultId: string;
  kind: AlbumKind;
  nameEncrypted: string | null;
  nameNonce: string | null;
  /** The album key wrapped under the vault key. Null for the Liked album. */
  keyWrapped: string | null;
  keyNonce: string | null;
  coverMediaId: string | null;
  sortOrder: number;
  mediaCount: number;
}

/** An album shared with the caller on its own, with their wrapped copy of its key. */
export interface SharedAlbumRow {
  id: string;
  vaultId: string;
  permission: SharePermission;
  wrappedKey: string;
  grantSig: string;
  granter: UserKeys | null;
  nameEncrypted: string | null;
  nameNonce: string | null;
  mediaCount: number;
}

export interface UploadInitResponse {
  mediaId: string;
  uploadUrls: { thumb: string; preview: string; original: string };
}

/** Decrypted contents of a media item's encryptedMeta. */
export interface MediaMeta {
  filename?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
}
