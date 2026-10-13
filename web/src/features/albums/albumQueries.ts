import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ensureAlbumKey, loadAlbums, markAlbumKeyLoaded, type AlbumView } from '@/lib/albums';
import { albumApi, mediaApi, PAGE_SIZE } from '@/lib/api/endpoints';
import type { Album, MediaItem, MediaPage } from '@/lib/api/types';
import { cryptoCall } from '@/lib/crypto/cryptoClient';
import { keyRefOf } from '@/lib/media/mediaKey';
import { useAlbumOnlyId, useVaultStore } from '@/state/vaultStore';

export type { AlbumView };

export const albumsKey = (vaultId: string) => ['albums', vaultId] as const;

/**
 * Albums of the open vault with names decrypted. The caller's Liked album comes
 * first. Someone who has only one album of the vault cannot list the others, so
 * for them this holds just that album.
 */
export function useAlbums(vaultId: string) {
  const albumOnlyId = useAlbumOnlyId();
  const label = useVaultStore((s) => s.label);
  return useQuery({
    queryKey: [...albumsKey(vaultId), albumOnlyId],
    queryFn: async (): Promise<AlbumView[]> => {
      if (!albumOnlyId) return loadAlbums(vaultId);
      const count = (await mediaApi.list(vaultId, 1, albumOnlyId, 1)).total;
      return [
        {
          id: albumOnlyId,
          vaultId,
          kind: 'regular',
          name: label ?? 'Shared album',
          nameEncrypted: null,
          nameNonce: null,
          keyWrapped: null,
          keyNonce: null,
          coverMediaId: null,
          sortOrder: 0,
          mediaCount: count,
        },
      ];
    },
    staleTime: 30_000,
  });
}

/** First item of an album, used as its cover. */
export function useAlbumCover(vaultId: string, album: Album) {
  return useQuery({
    queryKey: ['albumCover', vaultId, album.id],
    queryFn: async () => (await mediaApi.list(vaultId, 1, album.id, 1)).data[0] ?? null,
    enabled: album.mediaCount > 0,
    staleTime: 5 * 60_000,
  });
}

export function useAlbumActions(vaultId: string) {
  const queryClient = useQueryClient();

  const refreshAlbums = useCallback(
    () => queryClient.invalidateQueries({ queryKey: albumsKey(vaultId) }),
    [queryClient, vaultId],
  );

  /** An item from any loaded list of this vault: its wrapped key is needed to put it in an album. */
  const findItem = useCallback(
    (mediaId: string): MediaItem | undefined => {
      const lists = queryClient.getQueriesData<InfiniteData<MediaPage>>({ queryKey: ['media', vaultId] });
      for (const [, data] of lists) {
        for (const page of data?.pages ?? []) {
          const item = page.data.find((m) => m.id === mediaId);
          if (item) return item;
        }
      }
      return undefined;
    },
    [queryClient, vaultId],
  );

  const createAlbum = useCallback(
    async (name: string) => {
      // A fresh album key, wrapped under the vault key; the name is encrypted under the album key
      const album = await cryptoCall('createAlbum', { vaultId, name: name.trim() });
      const created = await albumApi.create({ vaultId, ...album });
      markAlbumKeyLoaded(album.id);
      await refreshAlbums();
      return created;
    },
    [vaultId, refreshAlbums],
  );

  const renameAlbum = useCallback(
    async (albumId: string, name: string) => {
      await ensureAlbumKey(albumId, vaultId);
      const encrypted = await cryptoCall('encryptAlbumName', { albumId, name: name.trim() });
      await albumApi.rename(albumId, { nameEncrypted: encrypted.encrypted, nameNonce: encrypted.nonce });
      await refreshAlbums();
    },
    [vaultId, refreshAlbums],
  );

  /** Put one item in an album: its key is re-wrapped under the album key, in the worker. */
  const addOne = useCallback(
    async (albumId: string, mediaId: string) => {
      const item = findItem(mediaId);
      if (!item) throw new Error('Item is not loaded');
      await ensureAlbumKey(albumId, vaultId);
      const key = await cryptoCall('rewrapMediaKey', { mediaId, key: await keyRefOf(item), target: { albumId } });
      await albumApi.addMedia(albumId, mediaId, key);
    },
    [findItem, vaultId],
  );

  const removeOne = useCallback(
    async (albumId: string, mediaId: string) => {
      try {
        await albumApi.removeMedia(albumId, mediaId);
      } catch (err) {
        if ((err as { status?: number }).status !== 409) throw err;
        // Uploaded by someone who had only this album, so the album holds the only
        // copy of its key. Give it a vault-wrapped key first, then take it out.
        const item = findItem(mediaId);
        if (!item) throw err;
        const key = await cryptoCall('rewrapMediaKey', { mediaId, key: await keyRefOf(item), target: { vaultId } });
        await mediaApi.setVaultKey(mediaId, key);
        await albumApi.removeMedia(albumId, mediaId);
      }
    },
    [findItem, vaultId],
  );

  /** Returns how many could not be changed. The API takes one photo per request. */
  const changeMembership = useCallback(
    async (albumId: string, mediaIds: string[], action: 'add' | 'remove') => {
      let failed = 0;
      const queue = [...mediaIds];
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          try {
            await (action === 'add' ? addOne(albumId, id) : removeOne(albumId, id));
          } catch (err) {
            // "Already in this album" / "not in this album" leave things as the user wanted
            const status = (err as { status?: number }).status;
            if (status !== 400 && status !== 404) failed++;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      await Promise.all([
        refreshAlbums(),
        queryClient.invalidateQueries({ queryKey: ['media', vaultId] }),
        queryClient.invalidateQueries({ queryKey: ['albumCover', vaultId, albumId] }),
      ]);
      return failed;
    },
    [queryClient, vaultId, refreshAlbums, addOne, removeOne],
  );

  /**
   * Delete an album; its items stay in the vault. Items uploaded by someone who
   * had only this album are given their vault-wrapped key first, or nobody
   * could decrypt them afterwards.
   */
  const deleteAlbum = useCallback(
    async (albumId: string) => {
      try {
        await albumApi.remove(albumId);
      } catch (err) {
        if ((err as { status?: number }).status !== 409) throw err;
        await ensureAlbumKey(albumId, vaultId);
        for (let page = 1; ; page++) {
          const list = await mediaApi.list(vaultId, page, albumId, PAGE_SIZE);
          for (const item of list.data) {
            if (item.key?.scope !== 'album') continue;
            const key = await cryptoCall('rewrapMediaKey', { mediaId: item.id, key: await keyRefOf(item), target: { vaultId } });
            await mediaApi.setVaultKey(item.id, key);
          }
          if (page >= list.totalPages) break;
        }
        await albumApi.remove(albumId);
      }
      queryClient.removeQueries({ queryKey: ['media', vaultId, albumId] });
      queryClient.removeQueries({ queryKey: ['albumCover', vaultId, albumId] });
      await Promise.all([refreshAlbums(), queryClient.invalidateQueries({ queryKey: ['media', vaultId] })]);
    },
    [queryClient, vaultId, refreshAlbums],
  );

  return { createAlbum, renameAlbum, changeMembership, deleteAlbum };
}
