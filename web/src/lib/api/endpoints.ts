import { request } from './client';
import type {
  AccessLevel,
  Album,
  InviteInfo,
  LoginResponse,
  Me,
  MediaPage,
  MediaType,
  MediaUrls,
  Member,
  ServerInfo,
  SharePermission,
  SharedAlbumRow,
  UploadInitResponse,
  UserList,
  UserStatus,
  VaultRow,
} from './types';
import type { UserKeys } from '../crypto/identity';
import type { AccountMaterial, ShareGrant } from '../crypto/protocol';

export const PAGE_SIZE = 100; // the API's maximum; fewer round trips against its rate limit

/** Public key material every new account sends. */
type NewAccountKeys = Omit<AccountMaterial, 'keyCert' | 'keyBinding'>;

export const authApi = {
  // `serverUrl` is given by the multi-server client, where no account exists yet to say which server
  login: (username: string, password: string, serverUrl?: string) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: { username, password }, auth: false, serverUrl }),
  /** `refreshToken` names the session to end when it is not in a cookie. */
  logout: (refreshToken?: string | null) =>
    request<{ message: string }>('/auth/logout', { method: 'POST', body: refreshToken ? { refreshToken } : {} }),
};

export const serverApi = {
  /** Public. What a Kura Vault server says about itself. `serverUrl` is omitted by the same-origin client. */
  info: (serverUrl?: string, signal?: AbortSignal) =>
    request<ServerInfo>('/health', { auth: false, serverUrl, signal }),
  /** Public, once: create the server's owner account with the setup key. */
  setup: (
    input: NewAccountKeys & { setupKey: string; id: string; username: string; password: string; keyCert: string },
    serverUrl?: string,
  ) => request<{ username: string }>('/setup', { method: 'POST', body: input, auth: false, serverUrl }),
};

export const inviteApi = {
  get: (inviteId: string, token: string, serverUrl?: string) =>
    request<InviteInfo>(`/invites/${inviteId}`, { auth: false, serverUrl, headers: { 'X-Invite-Token': token } }),
  accept: (
    inviteId: string,
    input: NewAccountKeys & { token: string; password: string; keyBinding: string },
    serverUrl?: string,
  ) => request<{ username: string }>(`/invites/${inviteId}/accept`, { method: 'POST', body: input, auth: false, serverUrl }),
};

export const meApi = {
  get: () => request<Me>('/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>('/me/password', { method: 'PUT', body: { currentPassword, newPassword } }),
  changeKeys: (input: { currentPassword: string; kdfSalt: string; encryptedPrivateKeys: string; privateKeysNonce: string }) =>
    request<{ message: string }>('/me/keys', { method: 'PUT', body: input }),
};

export const userApi = {
  /** Owner only. */
  list: () => request<UserList>('/users'),
  /** Certified, active users something can be shared with. Owner and full-access users. */
  directory: () => request<UserKeys[]>('/users/directory'),
  invite: (input: { id: string; username: string; accessLevel: AccessLevel; tokenHash: string; ownerSecretEncrypted: string }) =>
    request<{ id: string; userId: string; username: string; expiresAt: string }>('/users/invites', {
      method: 'POST',
      body: input,
    }),
  deleteInvite: (inviteId: string) => request<null>(`/users/invites/${inviteId}`, { method: 'DELETE' }),
  update: (userId: string, input: { accessLevel?: AccessLevel; status?: UserStatus }) =>
    request<unknown>(`/users/${userId}`, { method: 'PATCH', body: input }),
  certify: (userId: string, keyCert: string) =>
    request<null>(`/users/${userId}/cert`, { method: 'PUT', body: { keyCert } }),
  /** What deleting this user would erase: the vaults they created and everything in them. */
  deletionSummary: (userId: string) =>
    request<{ username: string; vaults: number; items: number }>(`/users/${userId}/deletion-summary`),
  remove: (userId: string) => request<null>(`/users/${userId}`, { method: 'DELETE' }),
};

/** Sharing works the same way for a vault and for an album. */
function membersApi(base: (id: string) => string) {
  return {
    list: (id: string) => request<Member[]>(base(id)),
    add: (id: string, userId: string, permission: SharePermission, grant: ShareGrant) =>
      request<null>(base(id), { method: 'POST', body: { userId, permission, ...grant } }),
    update: (id: string, userId: string, permission: SharePermission) =>
      request<null>(`${base(id)}/${userId}`, { method: 'PATCH', body: { permission } }),
    remove: (id: string, userId: string) => request<null>(`${base(id)}/${userId}`, { method: 'DELETE' }),
  };
}

export interface CreateVaultInput {
  id: string;
  wrappedKey: string;
  kdfSalt: string;
  labelEncrypted?: string;
  labelNonce?: string;
}

export const vaultApi = {
  /** The caller's own vaults and those shared with them. Nobody else's. */
  list: () => request<VaultRow[]>('/vaults'),
  create: (input: CreateVaultInput) => request<{ id: string }>('/vaults', { method: 'POST', body: input }),
  /** Creator only. Erases the vault and everything in it, for everyone. */
  remove: (vaultId: string) => request<null>(`/vaults/${vaultId}`, { method: 'DELETE' }),
  members: membersApi((vaultId) => `/vaults/${vaultId}/members`),
};

export interface UploadCompleteInput {
  mediaId: string;
  vaultId: string;
  albumId?: string;
  mediaType: MediaType;
  capturedAt?: string;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  durationSeconds?: number;
  keyWrappedVault?: string;
  keyNonceVault?: string;
  keyWrappedAlbum?: string;
  keyNonceAlbum?: string;
  thumbIv: string;
  previewIv: string;
  originalIv: string;
  encryptedMeta: string;
  metaNonce: string;
}

/** The most items one delete request may name. */
export const DELETE_BATCH = 100;

export const mediaApi = {
  list: (vaultId: string, page: number, albumId?: string | null, limit = PAGE_SIZE, signal?: AbortSignal) =>
    request<MediaPage>('/media', { query: { vaultId, page, limit, albumId }, signal }),
  urls: (mediaId: string) => request<MediaUrls>(`/media/${mediaId}/urls`),
  uploadInit: (input: { vaultId: string; albumId?: string; mediaType: MediaType; fileSizeBytes?: number }) =>
    request<UploadInitResponse>('/media/upload/init', { method: 'POST', body: input }),
  uploadComplete: (input: UploadCompleteInput) =>
    request<{ id: string }>('/media/upload/complete', { method: 'POST', body: input }),
  /** Erase items for good. All or nothing; at most `DELETE_BATCH` at a time. */
  remove: (ids: string[]) => request<{ deleted: number }>('/media/delete', { method: 'POST', body: { ids } }),
  /** Give an item uploaded through an album its vault-wrapped key. */
  setVaultKey: (mediaId: string, key: { wrapped: string; nonce: string }) =>
    request<null>(`/media/${mediaId}/vault-key`, { method: 'PUT', body: { keyWrapped: key.wrapped, keyNonce: key.nonce } }),
};

export const albumApi = {
  list: (vaultId: string) => request<Album[]>('/albums', { query: { vaultId } }),
  /** Albums shared with the caller on their own. */
  shared: () => request<SharedAlbumRow[]>('/albums/shared'),
  create: (input: { id: string; vaultId: string; nameEncrypted: string; nameNonce: string; keyWrapped: string; keyNonce: string }) =>
    request<Album>('/albums', { method: 'POST', body: input }),
  rename: (albumId: string, input: { nameEncrypted: string; nameNonce: string }) =>
    request<Album>(`/albums/${albumId}`, { method: 'PUT', body: input }),
  addMedia: (albumId: string, mediaId: string, key: { wrapped: string; nonce: string }) =>
    request<null>(`/albums/${albumId}/media`, {
      method: 'POST',
      body: { mediaId, keyWrapped: key.wrapped, keyNonce: key.nonce },
    }),
  /** Delete the album. Its items stay in the vault. */
  remove: (albumId: string) => request<null>(`/albums/${albumId}`, { method: 'DELETE' }),
  removeMedia: (albumId: string, mediaId: string) =>
    request<null>(`/albums/${albumId}/media/${mediaId}`, { method: 'DELETE' }),
  like: (mediaId: string, vaultId: string) =>
    request<null>(`/albums/liked/media/${mediaId}`, { method: 'PUT', body: { vaultId } }),
  unlike: (mediaId: string, vaultId: string) =>
    request<null>(`/albums/liked/media/${mediaId}`, { method: 'DELETE', query: { vaultId } }),
  members: membersApi((albumId) => `/albums/${albumId}/members`),
};
