import { useMatch } from 'react-router-dom';
import { useAlbums } from '../albums/albumQueries';
import { useVaultId, useVaultStore } from '@/state/vaultStore';

/**
 * Where an upload started on this screen should land: always the open vault, and
 * also the album being viewed when that is a regular album. With only one album
 * shared, that album is the only place an upload can go.
 */
export function useUploadTarget(): { vaultId: string; albumId: string | null; albumName: string | null } {
  const vaultId = useVaultId();
  const albumOnlyId = useVaultStore((s) => s.albumId);
  const label = useVaultStore((s) => s.label);
  const match = useMatch('/albums/:albumId');
  const albums = useAlbums(vaultId);
  // Known without waiting for any list: an upload started early must not fall outside the album
  if (albumOnlyId) return { vaultId, albumId: albumOnlyId, albumName: label };
  const album = albums.data?.find((a) => a.id === match?.params.albumId && a.kind === 'regular');
  return { vaultId, albumId: album?.id ?? null, albumName: album?.name ?? null };
}
