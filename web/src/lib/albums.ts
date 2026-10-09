// Album keys live in the worker; this module remembers which ones are there, so
// an item whose key is wrapped under an album key can wait for it to be loaded.
import { albumApi } from './api/endpoints';
import type { Album } from './api/types';
import { cryptoCall } from './crypto/cryptoClient';

export interface AlbumView extends Album {
  /** Decrypted name. The server only ever holds the ciphertext. */
  name: string;
}

const loaded = new Set<string>();
const loading = new Map<string, Promise<AlbumView[]>>();

export function markAlbumKeyLoaded(albumId: string): void {
  loaded.add(albumId);
}

/** The worker dropped its album keys (a vault was closed, or everything was locked). */
export function forgetAlbumKeys(): void {
  loaded.clear();
  loading.clear();
}

/**
 * A vault's albums with names decrypted, and their keys loaded into the worker
 * through the vault key. The caller's Liked album comes first.
 */
export function loadAlbums(vaultId: string): Promise<AlbumView[]> {
  let pending = loading.get(vaultId);
  if (!pending) {
    pending = (async () => {
      const albums = await albumApi.list(vaultId);
      const names = await cryptoCall('openAlbums', { vaultId, albums });
      for (const album of albums) if (album.keyWrapped) loaded.add(album.id);
      return albums.map((album, i) => ({
        ...album,
        name: album.kind === 'liked' ? 'Liked' : names[i]?.trim() || 'Untitled album',
      }));
    })().finally(() => loading.delete(vaultId));
    loading.set(vaultId, pending);
  }
  return pending;
}

/** Make sure the worker holds this album's key before something wrapped under it is used. */
export async function ensureAlbumKey(albumId: string, vaultId: string): Promise<void> {
  if (!loaded.has(albumId)) await loadAlbums(vaultId);
}
