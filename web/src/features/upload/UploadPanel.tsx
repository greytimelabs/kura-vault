import { clsx } from 'clsx';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, RotateCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { formatBytes } from '@/lib/format';
import { clearSettledUploads, retryUpload } from '@/lib/upload/uploadQueue';
import { isActive, useUploadStore, type UploadItem } from '@/state/uploadStore';

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  queued: 'Waiting',
  processing: 'Preparing',
  encrypting: 'Encrypting',
  uploading: 'Uploading',
  done: 'Uploaded',
  failed: 'Failed',
};

/** Upload progress, docked bottom-right like a download shelf. */
export function UploadPanel() {
  const items = useUploadStore((s) => s.items);
  const open = useUploadStore((s) => s.panelOpen);
  const setOpen = useUploadStore((s) => s.setPanelOpen);

  const active = items.filter(isActive).length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const done = items.filter((item) => item.status === 'done').length;

  // Closing the tab mid-upload loses the files still in the queue; let the browser ask first
  useEffect(() => {
    if (active === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  if (items.length === 0) return null;

  const summary =
    active > 0
      ? `Uploading ${active} of ${items.length}`
      : failed > 0
        ? `${done} uploaded, ${failed} failed`
        : `${done} uploaded`;

  return (
    <section
      aria-label="Uploads"
      data-testid="upload-panel"
      className="pop-in fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl"
    >
      <header className="flex items-center gap-1 py-1.5 pl-4 pr-1.5">
        <p className="flex-1 text-sm font-medium text-ink" role="status">
          {summary}
        </p>
        <IconButton label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="size-5" /> : <ChevronUp className="size-5" />}
        </IconButton>
        {active === 0 && (
          <IconButton label="Dismiss" onClick={clearSettledUploads}>
            <X className="size-5" />
          </IconButton>
        )}
      </header>

      {open && (
        <ul className="max-h-72 overflow-y-auto border-t border-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center">
                {item.status === 'done' ? (
                  <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
                ) : item.status === 'failed' ? (
                  <AlertCircle className="size-5 text-danger" aria-hidden />
                ) : (
                  <Spinner className="size-4 text-muted" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{item.file.name}</p>
                <p className={clsx('truncate text-xs', item.status === 'failed' ? 'text-danger' : 'text-muted')}>
                  {item.status === 'failed'
                    ? item.error
                    : `${STATUS_TEXT[item.status]}${
                        item.status === 'uploading' ? ` ${Math.round(item.progress * 100)}%` : ''
                      } · ${formatBytes(item.file.size)}`}
                </p>
                {item.status === 'uploading' && (
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                    aria-label={`Uploading ${item.file.name}`}
                    className="mt-1.5 h-1 overflow-hidden rounded-full bg-tile"
                  >
                    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${item.progress * 100}%` }} />
                  </div>
                )}
              </div>
              {item.status === 'failed' && (
                <IconButton label="Retry" className="size-8" onClick={() => retryUpload(item.id)}>
                  <RotateCw className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
