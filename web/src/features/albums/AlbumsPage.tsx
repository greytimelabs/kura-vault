import { FolderPlus, Heart, Images, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlbumNameDialog } from './AlbumNameDialog';
import { useAlbumActions, useAlbumCover, useAlbums, type AlbumView } from './albumQueries';
import { PageHeader } from '../shell/PageHeader';
import { EncryptedThumb } from '../timeline/EncryptedThumb';
import { Button } from '@/components/ui/Button';
import { ErrorState, StateMessage } from '@/components/ui/StateMessage';
import { errorMessage } from '@/lib/api/client';
import { pluralize } from '@/lib/format';
import { useIsOwner } from '@/state/authStore';
import { toast } from '@/state/toastStore';
import { useVaultId } from '@/state/vaultStore';

export function AlbumsPage() {
  const vaultId = useVaultId();
  const isOwner = useIsOwner();
  const albums = useAlbums(vaultId);
  const { createAlbum } = useAlbumActions(vaultId);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Albums"
        actions={
          isOwner && (
            <Button variant="primary" icon={<FolderPlus className="size-4" />} onClick={() => setCreating(true)}>
              New album
            </Button>
          )
        }
      />

      {albums.isPending ? (
        <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="skeleton aspect-square rounded-xl" />
              <div className="skeleton mt-3 h-4 w-2/3 rounded" />
            </div>
          ))}
        </div>
      ) : albums.error ? (
        <ErrorState message={errorMessage(albums.error, 'Error loading albums')} onRetry={() => void albums.refetch()} />
      ) : albums.data.length === 0 ? (
        <StateMessage icon={<Images className="size-10" aria-hidden />} title="No albums yet" />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-5 gap-y-7">
          {albums.data.map((album) => (
            <li key={album.id}>
              <AlbumCard vaultId={vaultId} album={album} />
            </li>
          ))}
        </ul>
      )}

      <AlbumNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New album"
        submitLabel="Create"
        onSubmit={async (name) => {
          await createAlbum(name);
          toast(`Created ${name}`);
        }}
      />
    </>
  );
}

function AlbumCard({ vaultId, album }: { vaultId: string; album: AlbumView }) {
  const cover = useAlbumCover(vaultId, album);
  const isLiked = album.kind === 'liked';

  return (
    <Link to={`/albums/${album.id}`} className="group block rounded-xl">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-tile transition-shadow group-hover:shadow-lg">
        {cover.data ? (
          <EncryptedThumb
            item={cover.data}
            onExpired={() => void cover.refetch()}
            className="size-full transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted">
            {isLiked ? <Heart className="size-10" aria-hidden /> : <Images className="size-10" aria-hidden />}
          </div>
        )}
        {isLiked && (
          <span className="absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/55 text-white">
            <Heart className="size-4 fill-red-500 text-red-500" aria-hidden />
          </span>
        )}
      </div>
      <h2 className="mt-2.5 truncate text-[15px] font-medium text-ink">{album.name}</h2>
      <p className="flex items-center gap-1 text-[13px] text-muted">
        <Lock className="size-3" aria-hidden />
        {pluralize(album.mediaCount, 'item')}
      </p>
    </Link>
  );
}
