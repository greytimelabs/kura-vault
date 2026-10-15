import * as Tooltip from '@radix-ui/react-tooltip';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/Toaster';
import { FullPageSpinner } from '@/components/ui/StateMessage';
import { AlbumPage } from '@/features/albums/AlbumPage';
import { AlbumsPage } from '@/features/albums/AlbumsPage';
import { JoinPage } from '@/features/auth/JoinPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ServerPage } from '@/features/auth/ServerPage';
import { SetupPage } from '@/features/auth/SetupPage';
import { DeleteAccountPage } from '@/features/legal/DeleteAccountPage';
import { PrivacyPage } from '@/features/legal/PrivacyPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AppShell } from '@/features/shell/AppShell';
import { useAutoLock } from '@/features/shell/useAutoLock';
import { TimelinePage } from '@/features/timeline/TimelinePage';
import { SpacesPage } from '@/features/unlock/SpacesPage';
import { UnlockPage } from '@/features/unlock/UnlockPage';
import { UsersPage } from '@/features/users/UsersPage';
import { queryClient } from '@/lib/queryClient';
import { MULTI_SERVER } from '@/lib/config';
import { bootstrapSession, signInPath } from '@/lib/session';
import { useAccountStore } from '@/state/accountStore';
import { useAuthStore, useIsOwner } from '@/state/authStore';
import { applyTheme, usePreferences } from '@/state/preferences';
import { useVaultStore } from '@/state/vaultStore';

const HOME = '/timeline';

// Once per page load, however many times React mounts the tree
let bootstrap: Promise<void> | null = null;

/** Signed-in screens. Everyone else goes to the sign-in page. */
function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  // Multi-server: which sign-in screen depends on the active account
  useAccountStore((s) => s.activeId);
  if (status === 'loading') {
    return (
      <div className="h-dvh">
        <FullPageSpinner />
      </div>
    );
  }
  return status === 'authenticated' ? <Outlet /> : <Navigate to={signInPath()} replace />;
}

/** Sign-in and first-run setup. Pointless once signed in. */
function PublicOnly() {
  const status = useAuthStore((s) => s.status);
  const { search } = useLocation();
  // Multi-server: a signed-in user comes back here to add another account
  const adding = MULTI_SERVER && new URLSearchParams(search).get('add') === '1';
  if (status === 'loading') {
    return (
      <div className="h-dvh">
        <FullPageSpinner />
      </div>
    );
  }
  return status === 'authenticated' && !adding ? <Navigate to="/unlock" replace /> : <Outlet />;
}

/** Where an open vault or shared album starts. */
function useHome(): string {
  const albumId = useVaultStore((s) => s.albumId);
  return albumId ? `/albums/${albumId}` : HOME;
}

/** Screens that need an open vault or album. Remembers where the user was heading. */
function RequireUnlocked() {
  const unlocked = useVaultStore((s) => s.unlocked);
  const albumId = useVaultStore((s) => s.albumId);
  const location = useLocation();
  const closedByUser = useVaultStore((s) => s.closedByUser);
  // Only the path: an open-photo parameter means nothing after the keys are gone.
  // After a deliberate close there is nowhere to return to: the next vault may be another one.
  if (!unlocked) {
    return <Navigate to="/unlock" replace state={closedByUser ? undefined : { from: location.pathname }} />;
  }
  // With one album shared, the timeline and the album list do not exist
  const reachable = !albumId || location.pathname === `/albums/${albumId}` || location.pathname === '/settings';
  return reachable ? <Outlet /> : <Navigate to={`/albums/${albumId}`} replace />;
}

/** Master passphrase first, then the choice of what to open. */
function UnlockRoute() {
  const accountUnlocked = useVaultStore((s) => s.accountUnlocked);
  const unlocked = useVaultStore((s) => s.unlocked);
  const albumId = useVaultStore((s) => s.albumId);
  const home = useHome();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  if (unlocked) return <Navigate to={albumId ? home : (from ?? home)} replace />;
  return accountUnlocked ? <SpacesPage /> : <UnlockPage />;
}

/** User management: the owner, with their keys loaded to verify and invite people. */
function OwnerOnly() {
  const accountUnlocked = useVaultStore((s) => s.accountUnlocked);
  const isOwner = useIsOwner();
  return accountUnlocked && isOwner ? <Outlet /> : <Navigate to="/unlock" replace />;
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
  useAutoLock();

  useEffect(() => {
    bootstrap ??= bootstrapSession();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicOnly />}>
              {MULTI_SERVER && <Route path="/server" element={<ServerPage />} />}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<SetupPage />} />
            </Route>
            {/* An invite link works whoever is or is not signed in on this browser */}
            <Route path="/join" element={<JoinPage />} />
            {/* Greytimelabs' policies, linked from the store listings. Only the hosted client is theirs to speak for. */}
            {MULTI_SERVER && <Route path="/privacy" element={<PrivacyPage />} />}
            {MULTI_SERVER && <Route path="/delete-account" element={<DeleteAccountPage />} />}
            <Route element={<RequireAuth />}>
              <Route path="/unlock" element={<UnlockRoute />} />
              <Route element={<OwnerOnly />}>
                <Route path="/users" element={<UsersPage />} />
              </Route>
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
