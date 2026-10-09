import { useVirtualizer } from '@tanstack/react-virtual';
import { clsx } from 'clsx';
import { Check, Heart, Play } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { EncryptedThumb } from './EncryptedThumb';
import { useScrollElement } from '../shell/ScrollContext';
import { Spinner } from '@/components/ui/Spinner';
import type { MediaItem } from '@/lib/api/types';
import { formatDateTime, formatDuration, formatYearMonth } from '@/lib/format';
import { useSelectionStore } from '@/state/selectionStore';

const GAP = 4;
const TARGET_TILE = 176;
const MIN_COLUMNS = 3;
const HEADER_HEIGHT = 56;
const UNDATED = 'undated';

type Row = { kind: 'header'; key: string; label: string } | { kind: 'tiles'; key: string; items: MediaItem[] };

interface MediaGridProps {
  items: MediaItem[];
  groupByMonth?: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore(): void;
  onOpen(itemId: string): void;
  onThumbExpired(itemId: string): Promise<void> | void;
  /** Show selection checkboxes (owners, who can file photos into albums). */
  selectable?: boolean;
}

function buildRows(items: MediaItem[], columns: number, groupByMonth: boolean): Row[] {
  const rows: Row[] = [];
  const pushTiles = (group: MediaItem[], prefix: string) => {
    for (let i = 0; i < group.length; i += columns) {
      rows.push({ kind: 'tiles', key: `${prefix}:${group[i]!.id}`, items: group.slice(i, i + columns) });
    }
  };

  if (!groupByMonth) {
    pushTiles(items, 'row');
    return rows;
  }

  // Items arrive newest first, so each month is one contiguous run
  let start = 0;
  while (start < items.length) {
    const month = items[start]!.yearMonth ?? UNDATED;
    let end = start + 1;
    while (end < items.length && (items[end]!.yearMonth ?? UNDATED) === month) end++;
    rows.push({ kind: 'header', key: `h:${month}`, label: month === UNDATED ? 'Undated' : formatYearMonth(month) });
    pushTiles(items.slice(start, end), month);
    start = end;
  }
  return rows;
}

export function MediaGrid({
  items,
  groupByMonth = false,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onOpen,
  onThumbExpired,
  selectable = false,
}: MediaGridProps) {
  const scrollElement = useScrollElement();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [offsetTop, setOffsetTop] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      // Distance from the top of the scrolled content, whatever sits above the grid
      const scrollTop = scrollElement?.scrollTop ?? 0;
      const scrollBox = scrollElement?.getBoundingClientRect().top ?? 0;
      setOffsetTop(el.getBoundingClientRect().top - scrollBox + scrollTop);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollElement]);

  const columns = Math.max(MIN_COLUMNS, Math.floor((width + GAP) / (TARGET_TILE + GAP)));
  const tile = width > 0 ? (width - GAP * (columns - 1)) / columns : TARGET_TILE;
  const rows = useMemo(() => buildRows(items, columns, groupByMonth), [items, columns, groupByMonth]);
  const orderedIds = useMemo(() => items.map((item) => item.id), [items]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: (index) => (rows[index]!.kind === 'header' ? HEADER_HEIGHT : tile + GAP),
    getItemKey: (index) => rows[index]!.key,
    overscan: 6,
    scrollMargin: offsetTop,
  });

  // Row heights depend on the tile size, which changes with the window width
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, tile, columns]);

  const virtualRows = virtualizer.getVirtualItems();
  const lastVisible = virtualRows.at(-1)?.index ?? 0;

  // Ask for the next page while there is still roughly a third of the list below
  useEffect(() => {
    if (hasMore && !isLoadingMore && rows.length > 0 && lastVisible >= Math.floor(rows.length * 0.7) - 1) {
      onLoadMore();
    }
  }, [hasMore, isLoadingMore, lastVisible, rows.length, onLoadMore]);

  return (
    <div ref={containerRef}>
      {width > 0 && (
        <div role="list" aria-label="Photos" className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            return (
              <div
                key={virtualRow.key}
                className="absolute left-0 top-0 w-full"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                {row.kind === 'header' ? (
                  <h2 className="flex h-full items-end pb-2 text-[15px] font-semibold text-ink">{row.label}</h2>
                ) : (
                  <div className="flex" style={{ gap: GAP }}>
                    {row.items.map((item) => (
                      <Tile
                        key={item.id}
                        item={item}
                        size={tile}
                        selectable={selectable}
                        orderedIds={orderedIds}
                        onOpen={onOpen}
                        onThumbExpired={onThumbExpired}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {isLoadingMore && (
        <div className="flex justify-center py-6 text-muted">
          <Spinner label="Loading more" />
        </div>
      )}
    </div>
  );
}

interface TileProps {
  item: MediaItem;
  size: number;
  selectable: boolean;
  orderedIds: string[];
  onOpen(itemId: string): void;
  onThumbExpired(itemId: string): Promise<void> | void;
}

const Tile = memo(function Tile({ item, size, selectable, orderedIds, onOpen, onThumbExpired }: TileProps) {
  const selected = useSelectionStore((s) => s.selected.has(item.id));
  const selecting = useSelectionStore((s) => s.selected.size > 0);
  const isVideo = item.mediaType === 'video';

  const select = (event: MouseEvent) => {
    const store = useSelectionStore.getState();
    if (event.shiftKey) store.selectRange(orderedIds, item.id);
    else store.toggle(item.id);
  };

  const handleClick = (event: MouseEvent) => {
    // Once anything is selected, a click extends the selection instead of opening
    if (selectable && (selecting || event.shiftKey || event.metaKey || event.ctrlKey)) select(event);
    else onOpen(item.id);
  };

  const date = formatDateTime(item.capturedAt);
  const label = `${isVideo ? 'Video' : 'Photo'}${date ? `, ${date}` : ''}${item.isLiked ? ', liked' : ''}`;

  return (
    <div role="listitem" className="group relative shrink-0" style={{ width: size, height: size }}>
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        className={clsx(
          'block size-full overflow-hidden bg-tile transition-[border-radius,transform] duration-150',
          selected ? 'scale-[0.9] rounded-xl' : 'rounded-[3px]',
        )}
      >
        <EncryptedThumb item={item} onExpired={onThumbExpired} className="size-full" />
      </button>

      {isVideo && (
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
          <Play className="size-3 fill-current" aria-hidden />
          {item.durationSeconds ? formatDuration(item.durationSeconds) : 'Video'}
        </span>
      )}

      {item.isLiked && (
        <Heart
          className="pointer-events-none absolute bottom-1.5 left-1.5 size-4 fill-white text-white drop-shadow"
          aria-hidden
        />
      )}

      {selectable && (
        <button
          type="button"
          onClick={select}
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? 'Deselect' : 'Select'}
          className={clsx(
            'absolute left-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border-2 transition-opacity',
            selected
              ? 'border-accent bg-accent text-accent-ink opacity-100'
              : 'border-white bg-black/30 text-transparent opacity-0 hover:bg-black/50 focus-visible:opacity-100 group-hover:opacity-100',
            selecting && 'opacity-100',
          )}
        >
          <Check className="size-4" strokeWidth={3} aria-hidden />
        </button>
      )}
    </div>
  );
});

/** Placeholder grid shown while the first page loads. */
export function MediaGridSkeleton() {
  return (
    <div aria-hidden className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TARGET_TILE - 32}px, 1fr))` }}>
      {Array.from({ length: 24 }, (_, i) => (
        <div key={i} className="skeleton aspect-square rounded-[3px]" />
      ))}
    </div>
  );
}
