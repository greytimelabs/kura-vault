import { Account, AlbumRow, UploadInitResponse, VaultRow } from './types';

/**
 * API client for the Kura Vault backend.
 */
export class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(what: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${what} failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    return data.data as T;
  }

  /**
   * Login with username + password to get JWT token.
   */
  async login(username: string, password: string): Promise<void> {
    const data = await this.request<{ accessToken: string }>('Login', '/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    this.accessToken = data.accessToken;
  }

  /** The signed-in account, with its private keys as only the master passphrase can open them. */
  getAccount(): Promise<Account> {
    return this.request<Account>('Loading the account', '/me');
  }

  /** The vaults this account can open, each with the account's wrapped copy of its key. */
  listVaults(): Promise<VaultRow[]> {
    return this.request<VaultRow[]>('Listing vaults', '/vaults');
  }

  listAlbums(vaultId: string): Promise<AlbumRow[]> {
    return this.request<AlbumRow[]>('Listing albums', `/albums?vaultId=${encodeURIComponent(vaultId)}`);
  }

  /**
   * Initialize upload — get the item's id and pre-signed S3 URLs.
   */
  uploadInit(input: { vaultId: string; albumId?: string; mediaType: string; fileSizeBytes?: number }): Promise<UploadInitResponse> {
    return this.request<UploadInitResponse>('Upload init', '/media/upload/init', { method: 'POST', body: input });
  }

  /**
   * Complete upload — store metadata and the item's wrapped key.
   */
  async uploadComplete(params: {
    mediaId: string;
    vaultId: string;
    albumId?: string;
    mediaType: string;
    capturedAt?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
    fileSizeBytes?: number;
    keyWrappedVault: string;
    keyNonceVault: string;
    keyWrappedAlbum?: string;
    keyNonceAlbum?: string;
    thumbIv: string;
    previewIv: string;
    originalIv: string;
    encryptedMeta: string;
    metaNonce: string;
  }): Promise<void> {
    await this.request('Upload complete', '/media/upload/complete', { method: 'POST', body: params });
  }
}
