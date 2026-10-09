import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Info,
  Maximize,
  Minimize,
  Play,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomableImage, type ZoomHandle } from './ZoomableImage';
import { useToggleLike } from '../timeline/mediaQueries';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/lib/api/client';
import type { MediaItem } from '@/lib/api/types';
import { VaultLockedError } from '@/lib/crypto/cryptoClient';
import { formatDateTime, formatDuration } from '@/lib/format';
import { TooLargeError } from '@/lib/media/blobFetch';
import { decryptMeta, downloadOriginal, loadPreviewUrl, peekPreviewUrl } from '@/lib/media/previewLoader';
import { peekThumbUrl } from '@/lib/media/thumbLoader';
import { toast } from '@/state/toastStore';

const PRELOAD_DELAY_MS = 400;

interface ViewerProps {
  vaultId: string;
  /** The list the viewer steps through, in display order. */
  items: MediaItem[];
  itemId: string;
  hasMore: boolean;
  onLoadMore(): void;
  onShow(itemId: string): void;
  onClose(): void;
}

type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };

function usePreview(item: MediaItem | undefined) {
  const [state, setState] = useState<{ id: string; url?: string; failed?: boolean }>({ id: '' });

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setState({ id: item.id, url: peekPreviewUrl(item.id) });
    loadPreviewUrl(item).then(
      (url) => {
        if (!cancelled) setState({ id: item.id, url });
      },
      (err: unknown) => {
        if (!cancelled && !(err instanceof VaultLockedError)) setState({ id: item.id, failed: true });
      },
    );
    return () => {
      cancelled = true;
    };
    // The item object is replaced on every like; only its identity matters here
  }, [item?.id]);

  // Ignore a result that belongs to the previous photo
  return item && state.id === item.id ? state : { id: item?.id ?? '' };
}

export function Viewer({ vaultId, items, itemId, hasMore, onLoadMore, onShow, onClose }: ViewerProps) {
  const index = items.findIndex((item) => item.id === itemId);
  const item = index === -1 ? undefined : items[index];
  const previous = index > 0 ? items[index - 1] : undefined;
  const next = index !== -1 && index < items.length - 1 ? items[index + 1] : undefined;

  const preview = usePreview(item);
  const toggleLike = useToggleLike(vaultId);
  const zoomRef = useRef<ZoomHandle>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // The photo is not in the list (a stale link, or the list changed): nothing to show
  useEffect(() => {
    if (index === -1) onClose();
  }, [index, onClose]);

  // Reaching the end of what is loaded: fetch the next page so "next" keeps working
  useEffect(() => {
    if (index !== -1 && index >= items.length - 3 && hasMore) onLoadMore();
  }, [index, items.length, hasMore, onLoadMore]);

  // Warm the next photo once this one has been on screen for a moment. One at a
  // time, after a pause, so flicking through does not flood the rate-limited API.
  useEffect(() => {
    if (!preview.url || !next) return;
    const timer = setTimeout(() => {
      void loadPreviewUrl(next).catch(() => undefined);
    }, PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [preview.url, next]);

  const download = useCallback(async () => {
    if (!item || downloading) return;
    setDownloading(true);
    try {
      await downloadOriginal(item);
    } catch (err) {
      if (!(err instanceof VaultLockedError)) {
        toast(err instanceof TooLargeError ? err.message : errorMessage(err, 'Could not download this file'), 'error');
      }
    } finally {
      setDownloading(false);
    }
  }, [item, downloading]);

  const toggleFullscreen = useCallback(() => {
    const doc = document as FullscreenDocument;
    // The whole page goes full screen, not just the viewer, so tooltips and
    // toasts (rendered elsewhere in the document) stay visible
    const root = document.documentElement as FullscreenElement;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      void (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      const doc = document as FullscreenDocument;
      setFullscreen(Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowLeft':
          if (previous) onShow(previous.id);
          break;
        case 'ArrowRight':
          if (next) onShow(next.id);
          break;
        case 'l':
        case 'L':
          if (item) void toggleLike(item);
          break;
        case 'd':
        case 'D':
          void download();
          break;
        case 'i':
        case 'I':
          setInfoOpen((open) => !open);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case '+':
        case '=':
          zoomRef.current?.zoomBy(1.5);
          break;
        case '-':
          zoomRef.current?.zoomBy(1 / 1.5);
          break;
        case '0':
          zoomRef.current?.reset();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previous, next, item, onShow, toggleLike, download, toggleFullscreen]);

  if (!item) return null;

  const isVideo = item.mediaType === 'video';
  const date = formatDateTime(item.capturedAt);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          ref={frameRef}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Focus the frame itself so the arrow keys work without tabbing first
            event.preventDefault();
            frameRef.current?.focus();
          }}
          tabIndex={-1}
          data-testid="viewer"
          data-item-id={item.id}
          className="fade-in fixed inset-0 z-[60] flex bg-black text-white outline-none"
        >
          <Dialog.Title className="sr-only">{isVideo ? 'Video' : 'Photo'} viewer</Dialog.Title>

          <div className="relative min-w-0 flex-1">
            <ZoomableImage
              key={item.id}
              ref={zoomRef}
              src={preview.url}
              placeholderSrc={peekThumbUrl(item.id)}
              alt={date ? `${isVideo ? 'Video' : 'Photo'} from ${date}` : isVideo ? 'Video' : 'Photo'}
            />

            {!preview.url && !preview.failed && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Spinner className="size-8 text-white/80" label="Decrypting" />
              </div>
            )}

            {preview.failed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
                <p>Could not load this {isVideo ? 'video' : 'photo'}</p>
              </div>
            )}

            {isVideo && (
              <div className="absolute inset-x-0 bottom-8 flex justify-center px-4">
                <div className="flex items-center gap-3 rounded-full bg-black/70 py-2 pl-4 pr-2 text-sm backdrop-blur-sm [-webkit-backdrop-filter:blur(4px)]">
                  <Play className="size-4 fill-current" aria-hidden />
                  <span>
                    Video{item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ''} — download to play
                  </span>
                  <Button variant="primary" size="sm" onClick={() => void download()} loading={downloading}>
                    Download
                  </Button>
                </div>
              </div>
            )}

            {/* Top bar */}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/60 to-transparent p-2">
              <div className="pointer-events-auto">
                <IconButton label="Close" shortcut="Esc" tone="onDark" onClick={onClose}>
                  <X className="size-5" />
                </IconButton>
              </div>
              <p className="ml-1 min-w-0 flex-1 truncate text-sm text-white/85">{date}</p>
              <div className="pointer-events-auto flex items-center">
                <IconButton label="Zoom out" shortcut="−" tone="onDark" onClick={() => zoomRef.current?.zoomBy(1 / 1.5)}>
                  <ZoomOut className="size-5" />
                </IconButton>
                <IconButton label="Zoom in" shortcut="+" tone="onDark" onClick={() => zoomRef.current?.zoomBy(1.5)}>
                  <ZoomIn className="size-5" />
                </IconButton>
                <IconButton
                  label={item.isLiked ? 'Unlike' : 'Like'}
                  shortcut="L"
                  tone="onDark"
                  aria-pressed={item.isLiked}
                  onClick={() => void toggleLike(item)}
                >
                  <Heart className={clsx('size-5', item.isLiked && 'fill-red-500 text-red-500')} />
                </IconButton>
                <IconButton
                  label="Download original"
                  shortcut="D"
                  tone="onDark"
                  disabled={downloading}
                  onClick={() => void download()}
                >
                  {downloading ? <Spinner className="size-5" /> : <Download className="size-5" />}
                </IconButton>
                <IconButton
                  label="Info"
                  shortcut="I"
                  tone="onDark"
                  aria-pressed={infoOpen}
                  onClick={() => setInfoOpen((open) => !open)}
                >
                  <Info className="size-5" />
                </IconButton>
                <IconButton
                  label={fullscreen ? 'Exit full screen' : 'Full screen'}
                  shortcut="F"
                  tone="onDark"
                  onClick={toggleFullscreen}
                >
                  {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
                </IconButton>
              </div>
            </div>

            {previous && (
              <div className="absolute left-2 top-1/2 -translate-y-1/2">
                <IconButton
                  label="Previous"
                  shortcut="←"
                  tone="onDark"
                  className="size-12 bg-black/40"
                  onClick={() => onShow(previous.id)}
                >
                  <ChevronLeft className="size-7" />
                </IconButton>
              </div>
            )}
            {next && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <IconButton
                  label="Next"
                  shortcut="→"
                  tone="onDark"
                  className="size-12 bg-black/40"
                  onClick={() => onShow(next.id)}
                >
                  <ChevronRight className="size-7" />
                </IconButton>
              </div>
            )}
          </div>

          {infoOpen && <InfoPanel item={item} onClose={() => setInfoOpen(false)} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InfoPanel({ item, onClose }: { item: MediaItem; onClose(): void }) {
  // Filename and location are inside the encrypted metadata; the server never sees them
  const meta = useQuery({
    queryKey: ['mediaMeta', item.id],
    queryFn: () => decryptMeta(item),
    staleTime: Infinity,
  });

  const rows: [string, string | null][] = [
    ['Taken', formatDateTime(item.capturedAt)],
    ['Type', item.mediaType === 'video' ? 'Video' : 'Photo'],
    ['Dimensions', item.width && item.height ? `${item.width} × ${item.height}` : null],
    ['Duration', item.durationSeconds ? formatDuration(item.durationSeconds) : null],
    ['File name', meta.data?.filename ?? null],
    [
      'Location',
      meta.data?.gpsLatitude !== undefined && meta.data.gpsLongitude !== undefined
        ? `${meta.data.gpsLatitude.toFixed(5)}, ${meta.data.gpsLongitude.toFixed(5)}`
        : null,
    ],
  ];

  return (
    <aside
      aria-label="Details"
      className="w-80 max-w-[85vw] shrink-0 overflow-y-auto border-l border-white/10 bg-neutral-900 p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Details</h2>
        <IconButton label="Close details" tone="onDark" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>
      <dl className="space-y-4 text-sm">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="text-white/55">{label}</dt>
              <dd className="mt-0.5 break-words">{value}</dd>
            </div>
          ))}
      </dl>
    </aside>
  );
}
