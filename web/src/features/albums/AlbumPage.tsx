import { Heart, Images, Pencil, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlbumNameDialog } from './AlbumNameDialog';
import { useAlbumActions, useAlbums } from './albumQueries';
import { ShareDialog } from '../sharing/ShareDialog';
import { PageHeader } from '../shell/PageHeader';
import { MediaView } from '../timeline/MediaView';
import { useDropUnliked } from '../timeline/mediaQueries';
import { Button } from '@/components/ui/Button';
import { StateMessage } from '@/components/ui/StateMessage';
import type { MediaItem } from '@/lib/api/types';
import { pluralize } from '@/lib/format';
import { toast } from '@/state/toastStore';
import { useAlbumOnlyId, useCanOrganise, useCanWrite, useIsCreator, useVaultId } from '@/state/vaultStore';

const isLiked = (item: MediaItem) => item.isLiked;

export function AlbumPage() {
  const { albumId = '' } = useParams();
  const vaultId = useVaultId();
  const canWrite = useCanWrite();
  const canOrganise = useCanOrganise();
  const isCreator = useIsCreator();
  // With only this album shared there is no album list to go back to
  const albumOnly = useAlbumOnlyId() !== null;
  const albums = useAlbums(vaultId);
  const { renameAlbum } = useAlbumActions(vaultId);
  const dropUnliked = useDropUnliked(vaultId, albumId);
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);

  const album = albums.data?.find((a) => a.id === albumId);
  const likedAlbum = album?.kind === 'liked';
  const title = album?.name ?? (albums.isPending ? '' : 'Album');

  return (
    <>
      <PageHeader
        title={title}
        subtitle={album ? pluralize(album.mediaCount, 'item') : undefined}
        backTo={albumOnly ? undefined : '/albums'}
        actions={
          album &&
          !likedAlbum && (
            <div className="flex gap-2">
              {isCreator && (
                <Button icon={<Share2 className="size-4" />} onClick={() => setSharing(true)}>
                  Share
                </Button>
              )}
              {canOrganise && (
                <Button icon={<Pencil className="size-4" />} onClick={() => setRenaming(true)}>
                  Rename
                </Button>
              )}
            </div>
          )
        }
      />

      <MediaView
        // A different album is a different list, viewer and selection
        key={albumId}
        vaultId={vaultId}
        albumId={albumId}
        // In Liked, a photo unliked in the viewer leaves the grid straight away
        filter={likedAlbum ? isLiked : undefined}
        onViewerClose={likedAlbum ? dropUnliked : undefined}
        selectable={!likedAlbum}
        album={album && !likedAlbum ? { id: album.id, name: album.name } : undefined}
        empty={
          likedAlbum ? (
            <StateMessage
              icon={<Heart className="size-10" aria-hidden />}
              title="No liked photos yet"
              detail="Open a photo and press L, or use the heart, to add it here."
            />
          ) : (
            <StateMessage
              icon={<Images className="size-10" aria-hidden />}
              title="This album is empty"
              detail={
                canOrganise
                  ? 'Select photos in the timeline and choose Add to album, or drop files here.'
                  : canWrite
                    ? 'Drop photos here to add them.'
                    : undefined
              }
            />
          )
        }
      />

      {album && isCreator && !likedAlbum && (
        <ShareDialog
          open={sharing}
          onOpenChange={setSharing}
          target={{ kind: 'album', id: album.id, name: album.name, vaultId }}
        />
      )}
      {album && (
        <AlbumNameDialog
          open={renaming}
          onOpenChange={setRenaming}
          title="Rename album"
          submitLabel="Save"
          initialName={album.name}
          onSubmit={async (name) => {
            await renameAlbum(album.id, name);
            toast('Album renamed');
          }}
        />
      )}
    </>
  );
}
