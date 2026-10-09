export interface CliOptions {
  source: string;
  vaultId: string;
  albumId?: string;
  apiUrl: string;
  username: string;
  /** Secrets may be given as flags or environment variables; otherwise they are asked for. */
  password?: string;
  masterPassphrase?: string;
  passphrase?: string;
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

/** A key wrapped under another AES key. Both base64. */
export interface WrappedKey {
  wrapped: string;
  nonce: string;
}

/** Public facts about a user as the server reports them. Untrusted until the certificate verifies. */
export interface UserKeys {
  userId: string;
  username: string;
  publicEncKey: string;
  publicSignKey: string;
  keyCert: string | null;
}

/** The signed-in account's keys, in memory only. */
export interface Identity {
  userId: string;
  encSk: Buffer;
  encPk: Buffer;
  signSk: Buffer;
  /** The server owner's signing key, taken from the account's own encrypted bundle. */
  ownerSignPk: Buffer;
}

export interface Account {
  id: string;
  kdfSalt: string;
  encryptedPrivateKeys: string;
  privateKeysNonce: string;
  publicEncKey: string;
  publicSignKey: string;
}

/** A vault the account can open, with its wrapped copy of the vault key. */
export interface VaultRow {
  id: string;
  role: 'creator' | 'member';
  permission: 'view' | 'write';
  wrappedKey: string;
  kdfSalt: string | null;
  grantSig: string | null;
  granter: UserKeys | null;
}

export interface AlbumRow {
  id: string;
  kind: 'regular' | 'liked';
  keyWrapped: string | null;
  keyNonce: string | null;
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
