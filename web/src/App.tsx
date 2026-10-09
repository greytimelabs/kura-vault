import * as Tooltip from '@radix-ui/react-tooltip';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/Toaster';
import { FullPageSpinner } from '@/components/ui/StateMessage';
import { AlbumPage } from '@/features/albums/AlbumPage';
import { AlbumsPage } from '@/features/albums/AlbumsPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AppShell } from '@/features/shell/AppShell';
import { TimelinePage } from '@/features/timeline/TimelinePage';
import { UnlockPage } from '@/features/unlock/UnlockPage';
import { queryClient } from '@/lib/queryClient';
import { bootstrapSession } from '@/lib/session';
import { useAuthStore } from '@/state/authStore';
import { applyTheme, usePreferences } from '@/state/preferences';
import { useVaultStore } from '@/state/vaultStore';

const HOME = '/timeline';

// Once per page load, however many times React mounts the tree
let bootstrap: Promise<void> | null = null;

/** Signed-in screens. Everyone else goes to the sign-in page. */
function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') {
    return (
      <div className="h-dvh">
        <FullPageSpinner />
      </div>
    );
  }
  return status === 'authenticated' ? <Outlet /> : <Navigate to="/login" replace />;
}

/** Sign-in and register. Pointless once signed in. */
function PublicOnly() {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') {
    return (
      <div className="h-dvh">
        <FullPageSpinner />
      </div>
    );
  }
  return status === 'authenticated' ? <Navigate to="/unlock" replace /> : <Outlet />;
}

/** Screens that need vault keys. Remembers where the user was heading. */
function RequireUnlocked() {
  const unlocked = useVaultStore((s) => s.unlocked);
  const location = useLocation();
  // Only the path: an open-photo parameter means nothing after the keys are gone
  return unlocked ? <Outlet /> : <Navigate to="/unlock" replace state={{ from: location.pathname }} />;
}

function UnlockRoute() {
  const unlocked = useVaultStore((s) => s.unlocked);
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return unlocked ? <Navigate to={from ?? HOME} replace /> : <UnlockPage />;
}

/** Follow the operating system's light/dark setting while the choice is "System". */
function useSystemTheme() {
  const theme = usePreferences((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);
}

export function App() {
  useSystemTheme();

  useEffect(() => {
    bootstrap ??= bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route path="/unlock" element={<UnlockRoute />} />
              <Route element={<RequireUnlocked />}>
                <Route element={<AppShell />}>
                  <Route path="/timeline" element={<TimelinePage />} />
                  <Route path="/albums" element={<AlbumsPage />} />
                  <Route path="/albums/:albumId" element={<AlbumPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to={HOME} replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
