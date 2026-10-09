import { FolderMinus, FolderPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AddToAlbumDialog } from '../albums/AddToAlbumDialog';
import { useAlbumActions } from '../albums/albumQueries';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { pluralize } from '@/lib/format';
import { useSelectionStore } from '@/state/selectionStore';
import { toast } from '@/state/toastStore';

interface SelectionBarProps {
  vaultId: string;
  /** Set when showing a regular album, which enables "Remove from album". */
  album?: { id: string; name: string };
}

/** Floating actions for the selected photos. Owners only. */
export function SelectionBar({ vaultId, album }: SelectionBarProps) {
  const selected = useSelectionStore((s) => s.selected);
  const clear = useSelectionStore((s) => s.clear);
  const { changeMembership } = useAlbumActions(vaultId);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const count = selected.size;

  // A selection belongs to the screen it was made on
  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (count === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !adding) clear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [count, adding, clear]);

  if (count === 0) return null;

  const removeFromAlbum = async () => {
    if (!album) return;
    setRemoving(true);
    try {
      const failed = await changeMembership(album.id, [...selected], 'remove');
      if (failed > 0) toast(`${pluralize(failed, 'item')} could not be removed`, 'error');
      else toast(`Removed ${pluralize(count, 'item')} from ${album.name}`);
      clear();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Selection"
        className="pop-in fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-raised py-1.5 pl-2 pr-3 shadow-2xl"
      >
        <IconButton label="Clear selection" shortcut="Esc" onClick={clear}>
          <X className="size-5" />
        </IconButton>
        <span className="mr-2 whitespace-nowrap text-sm font-medium text-ink" aria-live="polite">
          {count.toLocaleString()} selected
        </span>
        <Button size="sm" variant="primary" icon={<FolderPlus className="size-4" />} onClick={() => setAdding(true)}>
          Add to album
        </Button>
        {album && (
          <Button
            size="sm"
            variant="danger"
            icon={<FolderMinus className="size-4" />}
            loading={removing}
            onClick={() => void removeFromAlbum()}
          >
            Remove
          </Button>
        )}
      </div>

      <AddToAlbumDialog
        open={adding}
        onOpenChange={setAdding}
        vaultId={vaultId}
        mediaIds={[...selected]}
        excludeAlbumId={album?.id}
        onDone={clear}
      />
    </>
  );
}
