import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { albumApi, mediaApi } from '@/lib/api/endpoints';
import type { Album } from '@/lib/api/types';
import { cryptoCall } from '@/lib/crypto/cryptoClient';

export interface AlbumView extends Album {
  /** Decrypted name. The server only ever holds the ciphertext. */
  name: string;
}

export const albumsKey = (vaultId: string) => ['albums', vaultId] as const;

/** Albums of the open vault with names decrypted. The caller's Liked album comes first. */
export function useAlbums(vaultId: string) {
  return useQuery({
    queryKey: albumsKey(vaultId),
    queryFn: async (): Promise<AlbumView[]> => {
      const albums = await albumApi.list(vaultId);
      const names = await cryptoCall('decryptTexts', {
        items: albums.map((album) => ({ encrypted: album.nameEncrypted, nonce: album.nameNonce })),
      });
      return albums.map((album, i) => ({
        ...album,
        name: album.kind === 'liked' ? 'Liked' : names[i]?.trim() || 'Untitled album',
      }));
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

  const createAlbum = useCallback(
    async (name: string) => {
      const encrypted = await cryptoCall('encryptText', { text: name.trim() });
      const album = await albumApi.create({ vaultId, nameEncrypted: encrypted.encrypted, nameNonce: encrypted.nonce });
      await refreshAlbums();
      return album;
    },
    [vaultId, refreshAlbums],
  );

  const renameAlbum = useCallback(
    async (albumId: string, name: string) => {
      const encrypted = await cryptoCall('encryptText', { text: name.trim() });
      await albumApi.rename(albumId, { nameEncrypted: encrypted.encrypted, nameNonce: encrypted.nonce });
      await refreshAlbums();
    },
    [refreshAlbums],
  );

  /** Returns how many could not be changed. The API takes one photo per request. */
  const changeMembership = useCallback(
    async (albumId: string, mediaIds: string[], action: 'add' | 'remove') => {
      let failed = 0;
      const queue = [...mediaIds];
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          try {
            await (action === 'add' ? albumApi.addMedia(albumId, id) : albumApi.removeMedia(albumId, id));
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
        queryClient.invalidateQueries({ queryKey: ['media', vaultId, albumId] }),
        queryClient.invalidateQueries({ queryKey: ['albumCover', vaultId, albumId] }),
      ]);
      return failed;
    },
    [queryClient, vaultId, refreshAlbums],
  );

  return { createAlbum, renameAlbum, changeMembership };
}
