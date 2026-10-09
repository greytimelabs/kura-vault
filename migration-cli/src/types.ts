export interface CliOptions {
  source: string;
  vaultId: string;
  passphrase: string;
  apiUrl: string;
  deviceId: string;
  password: string;
  concurrency: number;
  resume: boolean;
}

export interface FileInfo {
  path: string;
  type: 'photo' | 'video';
  capturedAt: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  fileSizeBytes: number;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
}

export interface ProcessedFile {
  original: Buffer;
  thumbnail: Buffer;
  preview: Buffer;
  metadata: FileInfo;
}

export interface EncryptedBlob {
  encrypted: Buffer;
  iv: Buffer;
}

export interface VaultInfo {
  id: string;
  kekSalt: string;
  kekVerify: string;
  kekVerifyNonce: string;
}

export interface UploadInitResponse {
  mediaId: string;
  uploadUrls: {
    thumb: string;
    preview: string;
    original: string;
  };
}

export type FileStatus = 'pending' | 'processing' | 'uploading' | 'completing' | 'done' | 'failed';
