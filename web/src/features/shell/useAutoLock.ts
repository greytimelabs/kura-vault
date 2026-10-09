import { useEffect } from 'react';
import { lockVault } from '@/lib/session';
import { usePreferences } from '@/state/preferences';
import { isActive, useUploadStore } from '@/state/uploadStore';

const CHECK_EVERY_MS = 15_000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Lock the vault after a period without input. Elapsed time is compared against a
 * timestamp rather than a single long timer, so a laptop that slept through the
 * deadline locks the moment it wakes.
 */
export function useAutoLock(): void {
  const minutes = usePreferences((s) => s.autoLockMinutes);

  useEffect(() => {
    if (minutes === 0) return;

    let lastActivity = Date.now();
    const markActive = () => {
      lastActivity = Date.now();
    };

    const check = () => {
      // An upload in progress counts as use; locking would throw the work away
      if (useUploadStore.getState().items.some(isActive)) {
        markActive();
        return;
      }
      if (Date.now() - lastActivity >= minutes * 60_000) lockVault();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, CHECK_EVERY_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive, { capture: true });
      }
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [minutes]);
}
