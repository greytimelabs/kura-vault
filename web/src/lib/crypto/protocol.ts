import type { EncryptedText, VaultInfo } from './vaultCrypto';

export interface VaultMatch {
  vaultId: string;
  /** Decrypted label, or a neutral "Vault N" fallback. Never the vault id. */
  label: string;
}

export interface EncryptedTier {
  data: ArrayBuffer;
  iv: string;
}

export interface EncryptedMedia {
  encryptedDek: string;
  dekNonce: string;
  thumb: EncryptedTier;
  preview: EncryptedTier;
  original: EncryptedTier;
  encryptedMeta: string;
  metaNonce: string;
}

/** Everything the UI can ask of the key-holding worker. Keys never cross this boundary. */
export interface CryptoApi {
  findMatches(args: { passphrase: string; vaults: VaultInfo[] }): VaultMatch[];
  selectVault(args: { vaultId: string }): void;
  discardMatches(args: Record<string, never>): void;
  createVault(args: { passphrase: string; label: string }): VaultInfo;
  decryptBlob(args: { encryptedDek: string; dekNonce: string; iv: string; data: ArrayBuffer }): ArrayBuffer;
  decryptText(args: { encrypted: string | null; nonce: string | null }): string | null;
  decryptTexts(args: { items: { encrypted: string | null; nonce: string | null }[] }): (string | null)[];
  encryptText(args: { text: string }): EncryptedText;
  encryptMedia(args: {
    thumb: ArrayBuffer;
    preview: ArrayBuffer;
    original: ArrayBuffer;
    meta: Record<string, unknown>;
  }): EncryptedMedia;
}

export type CryptoMethod = keyof CryptoApi;

export interface CryptoRequest {
  id: number;
  method: CryptoMethod;
  args: unknown;
}

export type CryptoResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
