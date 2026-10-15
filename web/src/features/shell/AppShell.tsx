import { clsx } from 'clsx';
import { Images, Lock, LogOut, Settings, SquareLibrary } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AccountMenu } from './AccountMenu';
import { ScrollContext } from './ScrollContext';
import { UploadButton, UploadDropzone } from '../upload/UploadControls';
import { UploadPanel } from '../upload/UploadPanel';
import { KuraMark } from '@/components/brand/KuraMark';
import { IconButton } from '@/components/ui/IconButton';
import { MULTI_SERVER } from '@/lib/config';
import { closeVault, lockVault } from '@/lib/session';
import { useCanWrite, useVaultStore } from '@/state/vaultStore';

const VAULT_NAV = [
  { to: '/timeline', label: 'Timeline', icon: Images },
  { to: '/albums', label: 'Albums', icon: SquareLibrary },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** Frame around every screen of an open vault or shared album: navigation, top bar, uploads. */
export function AppShell() {
  const canWrite = useCanWrite();
  const vaultLabel = useVaultStore((s) => s.label);
  const albumOnlyId = useVaultStore((s) => s.albumId);
  // With one album shared there is no timeline and no album list, just the album
  const NAV = albumOnlyId
    ? [
        { to: `/albums/${albumOnlyId}`, label: 'Album', icon: Images },
        { to: '/settings', label: 'Settings', icon: Settings },
      ]
    : VAULT_NAV;
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const { pathname } = useLocation();

  // A new screen starts at the top. Opening the viewer changes only the query
  // string, so the grid underneath keeps its place.
  useEffect(() => {
    scrollElement?.scrollTo({ top: 0 });
  }, [pathname, scrollElement]);

  return (
    <div className="flex h-dvh bg-bg text-ink">
      {/* Sidebar: full labels on wide screens, an icon rail on medium ones */}
      <nav
        aria-label="Main"
        className="hidden w-[72px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4 sm:flex lg:w-60"
      >
        <div className="mb-6 flex h-10 items-center gap-3 px-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <KuraMark className="size-[18px]" />
          </span>
          <span className="hidden text-[17px] font-semibold tracking-tight lg:block">Kura Vault</span>
        </div>
        <ul className="space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                title={label}
                className={({ isActive }) =>
                  clsx(
                    'flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors lg:justify-start',
                    isActive ? 'bg-accent-soft text-ink' : 'text-muted hover:bg-accent-soft hover:text-ink',
                  )
                }
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="sr-only lg:not-sr-only">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 lg:px-8">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted">
            <Lock className="size-4 shrink-0" aria-hidden />
            <span className="truncate" data-testid="vault-label">
              {vaultLabel}
            </span>
          </p>
          {canWrite && <UploadButton />}
          <IconButton label="Close vault" onClick={closeVault}>
            <LogOut className="size-5" />
          </IconButton>
          <IconButton label="Lock" onClick={lockVault}>
            <Lock className="size-5" />
          </IconButton>
          {MULTI_SERVER && <AccountMenu compact />}
        </header>

        <ScrollContext.Provider value={scrollElement}>
          <main ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-[1800px] px-4 pb-24 pt-5 lg:px-8">
              <Outlet />
            </div>
          </main>
        </ScrollContext.Provider>

        {/* Phones: navigation moves to the bottom edge */}
        <nav aria-label="Main" className="flex shrink-0 border-t border-line bg-surface sm:hidden">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                  isActive ? 'text-ink' : 'text-muted',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {canWrite && <UploadDropzone />}
      <UploadPanel />
    </div>
  );
}
