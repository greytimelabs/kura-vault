import { useMatch } from 'react-router-dom';
import { useAlbums } from '../albums/albumQueries';
import { useVaultId } from '@/state/vaultStore';

/**
 * Where an upload started on this screen should land: always the open vault, and
 * also the album being viewed when that is a regular (shared) album.
 */
export function useUploadTarget(): { vaultId: string; albumId: string | null; albumName: string | null } {
  const vaultId = useVaultId();
  const match = useMatch('/albums/:albumId');
  const albums = useAlbums(vaultId);
  const album = albums.data?.find((a) => a.id === match?.params.albumId && a.kind === 'regular');
  return { vaultId, albumId: album?.id ?? null, albumName: album?.name ?? null };
}
