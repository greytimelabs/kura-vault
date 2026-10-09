import { FolderPlus, Images } from 'lucide-react';
import { useState } from 'react';
import { AlbumNameDialog } from './AlbumNameDialog';
import { useAlbumActions, useAlbums } from './albumQueries';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { pluralize } from '@/lib/format';
import { toast } from '@/state/toastStore';

interface AddToAlbumDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  vaultId: string;
  mediaIds: string[];
  /** Hide the album the photos are already being viewed in. */
  excludeAlbumId?: string;
  onDone(): void;
}

export function AddToAlbumDialog({ open, onOpenChange, vaultId, mediaIds, excludeAlbumId, onDone }: AddToAlbumDialogProps) {
  const albums = useAlbums(vaultId);
  const { createAlbum, changeMembership } = useAlbumActions(vaultId);
  const [busyAlbumId, setBusyAlbumId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The Liked album is filled only by liking
  const choices = (albums.data ?? []).filter((album) => album.kind === 'regular' && album.id !== excludeAlbumId);

  const addTo = async (albumId: string, albumName: string) => {
    setBusyAlbumId(albumId);
    try {
      const failed = await changeMembership(albumId, mediaIds, 'add');
      if (failed > 0) toast(`${pluralize(failed, 'item')} could not be added to ${albumName}`, 'error');
      else toast(`Added ${pluralize(mediaIds.length, 'item')} to ${albumName}`);
      onOpenChange(false);
      onDone();
    } finally {
      setBusyAlbumId(null);
    }
  };

  return (
    <>
      <Modal
        open={open && !creating}
        onOpenChange={onOpenChange}
        title="Add to album"
        description={pluralize(mediaIds.length, 'item') + ' selected'}
      >
        <ul className="-mx-2 max-h-80 overflow-y-auto">
          <li>
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={busyAlbumId !== null}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-medium text-ink hover:bg-accent-soft"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <FolderPlus className="size-5" aria-hidden />
              </span>
              New album
            </button>
          </li>
          {choices.map((album) => (
            <li key={album.id}>
              <button
                type="button"
                onClick={() => void addTo(album.id, album.name)}
                disabled={busyAlbumId !== null}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm text-ink hover:bg-accent-soft disabled:opacity-60"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-tile text-muted">
                  {busyAlbumId === album.id ? <Spinner className="size-5" /> : <Images className="size-5" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{album.name}</span>
                  <span className="block text-[13px] text-muted">{pluralize(album.mediaCount, 'item')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {albums.isPending && (
          <div className="flex justify-center py-4 text-muted">
            <Spinner label="Loading albums" />
          </div>
        )}
      </Modal>

      <AlbumNameDialog
        open={creating}
        onOpenChange={setCreating}
        title="New album"
        submitLabel="Create and add"
        onSubmit={async (name) => {
          const album = await createAlbum(name);
          await addTo(album.id, name);
        }}
      />
    </>
  );
}
