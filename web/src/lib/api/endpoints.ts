import { request } from './client';
import type {
  Album,
  InviteResponse,
  LoginResponse,
  MediaPage,
  MediaType,
  MediaUrls,
  UploadInitResponse,
} from './types';
import type { VaultInfo } from '../crypto/vaultCrypto';

export const PAGE_SIZE = 100; // the API's maximum; fewer round trips against its rate limit

export const authApi = {
  login: (deviceId: string, password: string) =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: { deviceId, password }, auth: false }),

  register: (input: { name: string; deviceId: string; password: string; inviteCode?: string }) =>
    request<{ message: string }>('/auth/register', { method: 'POST', body: input, auth: false }),

  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST', body: {} }),
};

export interface CreateVaultInput {
  id: string;
  kekSalt: string;
  kekVerify: string;
  kekVerifyNonce: string;
  labelEncrypted?: string;
  labelNonce?: string;
}

export const vaultApi = {
  list: () => request<VaultInfo[]>('/vaults'),
  create: (input: CreateVaultInput) => request<{ id: string }>('/vaults', { method: 'POST', body: input }),
  invite: (vaultId: string) => request<InviteResponse>(`/vaults/${vaultId}/invite`, { method: 'POST', body: {} }),
};

export interface UploadCompleteInput {
  mediaId: string;
  vaultId: string;
  mediaType: MediaType;
  capturedAt?: string;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  durationSeconds?: number;
  encryptedDek: string;
  dekNonce: string;
  thumbIv: string;
  previewIv: string;
  originalIv: string;
  encryptedMeta: string;
  metaNonce: string;
}

export const mediaApi = {
  list: (vaultId: string, page: number, albumId?: string | null, limit = PAGE_SIZE, signal?: AbortSignal) =>
    request<MediaPage>('/media', { query: { vaultId, page, limit, albumId }, signal }),

  urls: (mediaId: string, vaultId: string) => request<MediaUrls>(`/media/${mediaId}/urls`, { query: { vaultId } }),

  uploadInit: (input: { vaultId: string; mediaType: MediaType; fileSizeBytes?: number }) =>
    request<UploadInitResponse>('/media/upload/init', { method: 'POST', body: input }),

  uploadComplete: (input: UploadCompleteInput) =>
    request<{ id: string }>('/media/upload/complete', { method: 'POST', body: input }),
};

export const albumApi = {
  list: (vaultId: string) => request<Album[]>('/albums', { query: { vaultId } }),

  create: (input: { vaultId: string; nameEncrypted: string; nameNonce: string }) =>
    request<Album>('/albums', { method: 'POST', body: input }),

  rename: (albumId: string, input: { nameEncrypted: string; nameNonce: string }) =>
    request<Album>(`/albums/${albumId}`, { method: 'PUT', body: input }),

  addMedia: (albumId: string, mediaId: string) =>
    request<null>(`/albums/${albumId}/media`, { method: 'POST', body: { mediaId } }),

  removeMedia: (albumId: string, mediaId: string) =>
    request<null>(`/albums/${albumId}/media/${mediaId}`, { method: 'DELETE' }),

  like: (mediaId: string, vaultId: string) =>
    request<null>(`/albums/liked/media/${mediaId}`, { method: 'PUT', body: { vaultId } }),

  unlike: (mediaId: string, vaultId: string) =>
    request<null>(`/albums/liked/media/${mediaId}`, { method: 'DELETE', query: { vaultId } }),
};
