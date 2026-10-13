import { useEffect, useRef, type ReactNode } from 'react';
import { MediaGrid, MediaGridSkeleton } from './MediaGrid';
import { SelectionBar } from './SelectionBar';
import { useMediaList } from './mediaQueries';
import { Viewer } from '../viewer/Viewer';
import { useViewerParam } from '../viewer/useViewerParam';
import { ErrorState } from '@/components/ui/StateMessage';
import { errorMessage } from '@/lib/api/client';
import type { MediaItem } from '@/lib/api/types';
import { useCanOrganise } from '@/state/vaultStore';

interface MediaViewProps {
  vaultId: string;
  albumId?: string | null;
  groupByMonth?: boolean;
  /** Shown when the list is empty. */
  empty: ReactNode;
  /** Narrow what the grid shows (the viewer still steps through everything loaded). */
  filter?(item: MediaItem): boolean;
  /** Regular album being shown, enabling "Remove from album" for people who can change the vault. */
  album?: { id: string; name: string };
  /** Albums other than the Liked one can be edited by people who can change the vault; Liked cannot. */
  selectable?: boolean;
  onViewerClose?(): void;
}

/** Grid plus viewer plus selection: the body of the timeline and of every album. */
export function MediaView({
  vaultId,
  albumId = null,
  groupByMonth = false,
  empty,
  filter,
  album,
  selectable = true,
  onViewerClose,
}: MediaViewProps) {
  const list = useMediaList(vaultId, albumId);
  const viewer = useViewerParam();
  // Moving items between albums takes the whole vault with write access
  const canOrganise = useCanOrganise();

  // Tell the parent once the viewer is really gone, not when closing starts:
  // changing the list while the viewer is still mounted would pull the open
  // photo out from under it
  const wasOpen = useRef(false);
  const onViewerCloseRef = useRef(onViewerClose);
  onViewerCloseRef.current = onViewerClose;
  useEffect(() => {
    if (wasOpen.current && !viewer.viewerId) onViewerCloseRef.current?.();
    wasOpen.current = Boolean(viewer.viewerId);
  }, [viewer.viewerId]);

  if (list.isLoading) return <MediaGridSkeleton />;
  if (list.error) {
    return <ErrorState message={errorMessage(list.error, 'Error loading media')} onRetry={() => void list.refetch()} />;
  }

  const gridItems = filter ? list.items.filter(filter) : list.items;

  return (
    <>
      {gridItems.length === 0 ? (
        empty
      ) : (
        <MediaGrid
          items={gridItems}
          groupByMonth={groupByMonth}
          hasMore={list.hasMore}
          isLoadingMore={list.isLoadingMore}
          onLoadMore={list.loadMore}
          onOpen={viewer.open}
          onThumbExpired={list.renewLinks}
          selectable={canOrganise && selectable}
        />
      )}

      {canOrganise && selectable && <SelectionBar vaultId={vaultId} album={album} />}

      {viewer.viewerId && (
        <Viewer
          vaultId={vaultId}
          items={list.items}
          itemId={viewer.viewerId}
          hasMore={list.hasMore}
          canDelete={canOrganise}
          onLoadMore={list.loadMore}
          onShow={viewer.show}
          onClose={viewer.close}
        />
      )}
    </>
  );
}
