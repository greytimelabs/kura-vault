import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { clsx } from 'clsx';
import { Check, ChevronDown, LogOut, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { hostOf } from '@/lib/serverUrl';
import { signInPath, signOut, switchAccount } from '@/lib/session';
import { useAuthStore } from '@/state/authStore';
import { useAccountStore } from '@/state/accountStore';

const itemClass =
  'flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-accent-soft';

/**
 * Multi-server only. Shows the active account and lists the others: pick one to
 * switch to it (everything is locked first), add another, or sign out.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const accounts = useAccountStore((s) => s.accounts);
  const activeId = useAccountStore((s) => s.activeId);
  const signedIn = useAuthStore((s) => s.status === 'authenticated');
  const active = accounts.find((a) => a.id === activeId);

  const select = async (id: string) => {
    if (id === activeId) return;
    await switchAccount(id);
    // Signed in: it needs its master passphrase. Otherwise: its password.
    navigate(useAuthStore.getState().status === 'authenticated' ? '/unlock' : signInPath(), { replace: true });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Accounts"
          className="inline-flex h-10 max-w-64 items-center gap-2 rounded-full px-2 text-sm text-ink transition-colors hover:bg-accent-soft"
        >
          <Initial name={active?.username ?? '?'} />
          {!compact && active && <span className="truncate">{active.username}</span>}
          <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-lg"
        >
          <DropdownMenu.Label className="px-2.5 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">
            Accounts
          </DropdownMenu.Label>
          {accounts.map((account) => (
            <DropdownMenu.Item
              key={account.id}
              className={itemClass}
              onSelect={() => void select(account.id)}
            >
              <Initial name={account.username} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{account.username}</span>
                <span className="block truncate text-[13px] text-muted">
                  {hostOf(account.serverUrl)}
                  {!account.signedIn && ' · Sign in required'}
                </span>
              </span>
              {account.id === activeId && <Check className="size-4 shrink-0 text-accent" aria-label="Active" />}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1.5 h-px bg-line" />
          <DropdownMenu.Item className={itemClass} onSelect={() => navigate('/server?add=1')}>
            <Plus className="size-4 shrink-0" aria-hidden />
            Add account
          </DropdownMenu.Item>
          {signedIn && (
            <DropdownMenu.Item className={clsx(itemClass, 'text-danger')} onSelect={() => void signOut()}>
              <LogOut className="size-4 shrink-0" aria-hidden />
              Sign out
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-accent-ink"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
