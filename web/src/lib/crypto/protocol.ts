import type { UserKeys } from './identity';
import type { Keyring } from './keyring';
import type { WrappedKey } from './vaultCrypto';

/** The account as the server stores it: public keys, and private keys only this user can decrypt. */
export interface AccountKeys {
  id: string;
  kdfSalt: string;
  encryptedPrivateKeys: string;
  privateKeysNonce: string;
  publicEncKey: string;
  publicSignKey: string;
}

/** What a new account sends to the server. Nothing in it is secret. */
export interface AccountMaterial extends Omit<AccountKeys, 'id'> {
  /** Owner only: their signature over their own keys. */
  keyCert: string | null;
  /** Invitee only: proof, keyed from the invite link, that these are their keys. */
  keyBinding: string | null;
}

export interface InviteMaterial {
  /** Goes into the invite link and nowhere else. */
  secret: string;
  tokenHash: string;
  ownerSecretEncrypted: string;
  ownerSignKey: string;
}

/** A vault this account created: its key is behind the vault passphrase. */
export interface OwnVault {
  id: string;
  wrappedKey: string;
  kdfSalt: string;
  labelEncrypted: string | null;
  labelNonce: string | null;
}

/** A vault someone else shared with this account. */
export interface SharedVault {
  id: string;
  wrappedKey: string;
  grantSig: string | null;
  granter: UserKeys | null;
  labelEncrypted: string | null;
  labelNonce: string | null;
}

export type NewVault = OwnVault;

export interface VaultMatch {
  vaultId: string;
  /** Decrypted label, or a neutral "Vault N" fallback. Never the vault id. */
  label: string;
}

export interface ShareGrant {
  wrappedKey: string;
  grantSig: string;
}

export interface AlbumKeyInfo {
  id: string;
  keyWrapped: string | null;
  keyNonce: string | null;
  nameEncrypted: string | null;
  nameNonce: string | null;
}

export interface NewAlbum {
  id: string;
  keyWrapped: string;
  keyNonce: string;
  nameEncrypted: string;
  nameNonce: string;
}

export interface SharedAlbum {
  id: string;
  wrappedKey: string;
  grantSig: string;
  granter: UserKeys | null;
  nameEncrypted: string | null;
  nameNonce: string | null;
}

/** An item's wrapped key and which key it is wrapped under. */
export interface MediaKeyRef {
  scope: 'vault' | 'album';
  vaultId: string;
  albumId: string | null;
  wrapped: string;
  nonce: string;
}

export interface EncryptedTier {
  data: ArrayBuffer;
  iv: string;
}

export interface EncryptedMedia {
  /** Null when uploading with only an album key. */
  vaultKey: WrappedKey | null;
  albumKey: WrappedKey | null;
  thumb: EncryptedTier;
  preview: EncryptedTier;
  original: EncryptedTier;
  encryptedMeta: string;
  metaNonce: string;
}

/**
 * Everything the page can ask of the key-holding worker. Only names listed here
 * are dispatched; none of them returns a key.
 */
export const CRYPTO_METHODS = [
  'createAccount',
  'unlockAccount',
  'changePassphrase',
  'isUnlocked',
  'isTrustRoot',
  'trustedOwnerKey',
  'createInvite',
  'certifyUser',
  'verifyUser',
  'createVault',
  'findMatches',
  'selectVault',
  'discardMatches',
  'openSharedVaults',
  'closeVault',
  'shareVault',
  'createAlbum',
  'openAlbums',
  'openSharedAlbums',
  'encryptAlbumName',
  'shareAlbum',
  'encryptMedia',
  'decryptBlob',
  'decryptMetas',
  'rewrapMediaKey',
] as const satisfies readonly (keyof Keyring)[];

export type CryptoMethod = (typeof CRYPTO_METHODS)[number];
export type CryptoArgs<M extends CryptoMethod> = Parameters<Keyring[M]>;
export type CryptoResult<M extends CryptoMethod> = Awaited<ReturnType<Keyring[M]>>;

export interface CryptoRequest {
  id: number;
  method: CryptoMethod;
  args: unknown;
}

export type CryptoResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export type { UserKeys, WrappedKey };
