import { UploadInitResponse, VaultInfo } from './types';

/**
 * API client for the Kura Vault backend.
 */
export class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Login with device_id + password to get JWT token.
   */
  async login(deviceId: string, password: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, password }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Login failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    this.accessToken = data.data.accessToken;
  }

  /**
   * List vaults with the salt and verification token needed to derive and check a KEK.
   */
  async listVaults(): Promise<VaultInfo[]> {
    const response = await fetch(`${this.baseUrl}/vaults`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Listing vaults failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    return data.data as VaultInfo[];
  }

  /**
   * Initialize upload — get pre-signed S3 URLs.
   */
  async uploadInit(vaultId: string, mediaType: string, metadata: {
    capturedAt?: string | null;
    width?: number | null;
    height?: number | null;
    durationSeconds?: number | null;
    fileSizeBytes?: number | null;
  }): Promise<UploadInitResponse> {
    const response = await fetch(`${this.baseUrl}/media/upload/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        vaultId,
        mediaType,
        ...metadata,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Upload init failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    return data.data as UploadInitResponse;
  }

  /**
   * Complete upload — store metadata + encrypted DEK.
   */
  async uploadComplete(params: {
    mediaId: string;
    vaultId: string;
    encryptedDek: string;
    dekNonce: string;
    thumbIv: string;
    previewIv: string;
    originalIv: string;
    encryptedMeta: string;
    metaNonce: string;
  }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/media/upload/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Upload complete failed (${response.status}): ${body}`);
    }
  }
}
