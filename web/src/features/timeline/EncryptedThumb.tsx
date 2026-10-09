import { clsx } from 'clsx';
import { ImageOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '@/lib/api/types';
import { VaultLockedError } from '@/lib/crypto/cryptoClient';
import { ExpiredUrlError } from '@/lib/media/blobFetch';
import { loadThumbUrl, peekThumbUrl } from '@/lib/media/thumbLoader';

const MAX_RENEWALS = 2;

interface EncryptedThumbProps {
  item: MediaItem;
  /** Ask for a fresh download link. The parent swaps in an item with a new `thumbUrl`. */
  onExpired?(itemId: string): Promise<void> | void;
  className?: string;
}

/** Fetches, decrypts and shows one thumbnail. A skeleton stands in until it is ready. */
export function EncryptedThumb({ item, onExpired, className }: EncryptedThumbProps) {
  const [url, setUrl] = useState(() => peekThumbUrl(item.id));
  const [failed, setFailed] = useState(false);
  const renewals = useRef(0);
  const [reload, setReload] = useState(0);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    let cancelled = false;
    const ready = peekThumbUrl(item.id);
    setUrl(ready);
    setFailed(false);
    if (ready) return;

    loadThumbUrl(item).then(
      (loaded) => {
        if (!cancelled) setUrl(loaded);
      },
      (err: unknown) => {
        if (cancelled || err instanceof VaultLockedError) return;
        if (err instanceof ExpiredUrlError && onExpiredRef.current && renewals.current < MAX_RENEWALS) {
          renewals.current++;
          // A renewed link changes item.thumbUrl, which runs this effect again
          void Promise.resolve(onExpiredRef.current(item.id)).catch(() => {
            if (!cancelled) setFailed(true);
          });
          return;
        }
        setFailed(true);
      },
    );

    return () => {
      cancelled = true;
    };
    // Reload only when the item or its link changes, not on every new object identity
  }, [item.id, item.thumbUrl, reload]);

  if (failed) {
    return (
      <div className={clsx('flex items-center justify-center bg-tile text-muted', className)}>
        <ImageOff className="size-5" aria-hidden />
      </div>
    );
  }

  if (!url) {
    return <div className={clsx('skeleton', className)} />;
  }

  return (
    <img
      src={url}
      alt=""
      draggable={false}
      decoding="async"
      // The object URL was evicted from the in-memory cache; load it again
      onError={() => setReload((n) => n + 1)}
      className={clsx('fade-in object-cover', className)}
    />
  );
}
