import { ensureAlbumKey } from '../albums';
import type { MediaItem } from '../api/types';
import type { Tier } from '../crypto/aad';
import { cryptoCall } from '../crypto/cryptoClient';
import type { MediaKeyRef } from '../crypto/protocol';

/** Nobody wrapped this item's key in a way this account can open. */
export class MissingKeyError extends Error {
  constructor() {
    super('This item cannot be decrypted with the keys you hold');
    this.name = 'MissingKeyError';
  }
}

/** The item's wrapped key and what it is wrapped under, with that key loaded in the worker. */
export async function keyRefOf(item: MediaItem): Promise<MediaKeyRef> {
  if (!item.key) throw new MissingKeyError();
  if (item.key.scope === 'album' && item.key.albumId) await ensureAlbumKey(item.key.albumId, item.vaultId);
  return { ...item.key, vaultId: item.vaultId };
}

/** Decrypt one tier of an item. Pass `transfer` to move the ciphertext into the worker instead of copying it. */
export async function decryptTier(
  item: MediaItem,
  tier: Tier,
  iv: string,
  data: ArrayBuffer,
  transfer: Transferable[] = [],
): Promise<ArrayBuffer> {
  const key = await keyRefOf(item);
  return cryptoCall('decryptBlob', { mediaId: item.id, tier, key, iv, data }, transfer);
}
