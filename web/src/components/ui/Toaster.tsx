import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useToastStore } from '@/state/toastStore';

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={clsx(
            'pop-in pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-xl',
            toast.tone === 'error' ? 'bg-red-700 text-white' : 'bg-neutral-900 text-white',
          )}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
            className="flex size-7 items-center justify-center rounded-full hover:bg-white/15"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
