import { clsx } from 'clsx';
import { KeyRound, Lock, LogOut, Share2, Trash2, UserRound, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShareDialog } from '../sharing/ShareDialog';
import { PageHeader } from '../shell/PageHeader';
import { CreateVaultDialog } from '../unlock/CreateVaultDialog';
import { Button } from '@/components/ui/Button';
import { clearThumbUrls } from '@/lib/media/thumbLoader';
import { clearThumbStore } from '@/lib/media/thumbStore';
import { MULTI_SERVER } from '@/lib/config';
import { hostOf } from '@/lib/serverUrl';
import { closeVault, discardVaultMatches, lockVault, removeAccount, signOut, switchAccount } from '@/lib/session';
import { useAccountStore } from '@/state/accountStore';
import { useAuthStore, useCanCreateVaults, useIsOwner } from '@/state/authStore';
import { AUTO_LOCK_OPTIONS, usePreferences, type ThemeChoice } from '@/state/preferences';
import { toast } from '@/state/toastStore';
import { useAlbumOnlyId, useIsCreator, useVaultId, useVaultStore } from '@/state/vaultStore';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const autoLockLabel = (minutes: number) => (minutes === 1 ? '1 minute' : `${minutes} minutes`);

export function SettingsPage() {
  const vaultId = useVaultId();
  const vaultLabel = useVaultStore((s) => s.label) ?? 'this vault';
  const user = useAuthStore((s) => s.user);
  const isOwner = useIsOwner();
  const canCreateVaults = useCanCreateVaults();
  const isCreator = useIsCreator();
  const albumOnly = useAlbumOnlyId() !== null;
  const navigate = useNavigate();
  const savedAccounts = useAccountStore((s) => s.accounts);
  const activeAccountId = useAccountStore((s) => s.activeId);
  const { theme, setTheme, autoLockMinutes, setAutoLockMinutes } = usePreferences();
  const [sharing, setSharing] = useState(false);
  const [creatingVault, setCreatingVault] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const clearCache = async () => {
    await clearThumbStore();
    clearThumbUrls();
    toast('Cache cleared');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />

      <Section title="Vault">
        {isCreator && (
          <Row
            icon={<Share2 className="size-5" />}
            title="Share this vault"
            detail={`Choose who else can open ${vaultLabel}, and whether they can add photos.`}
            action={<Button onClick={() => setSharing(true)}>Share</Button>}
          />
        )}
        <Row
          icon={<LogOut className="size-5" />}
          title={albumOnly ? 'Close album' : 'Close vault'}
          detail="Go back to the list of what you can open. You stay unlocked."
          action={<Button onClick={closeVault}>Close</Button>}
        />
        <Row
          icon={<Lock className="size-5" />}
          title="Lock"
          detail="Wipe every key from memory. The master passphrase is needed again."
          action={<Button onClick={lockVault}>Lock now</Button>}
        />
        <Row
          icon={<KeyRound className="size-5" />}
          title="Lock automatically"
          detail="Every key is wiped after this long without activity in this tab."
          action={
            <select
              aria-label="Lock automatically after"
              value={autoLockMinutes}
              onChange={(event) => setAutoLockMinutes(Number(event.target.value))}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              {AUTO_LOCK_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {autoLockLabel(minutes)}
                </option>
              ))}
            </select>
          }
        />
        <Row
          icon={<Trash2 className="size-5" />}
          title="Clear cache"
          detail="Remove cached thumbnails from this browser. They are stored encrypted."
          action={<Button onClick={() => void clearCache()}>Clear</Button>}
        />
      </Section>

      {(isOwner || canCreateVaults) && (
        <Section title="Manage">
          {isOwner && (
            <Row
              icon={<Users className="size-5" />}
              title="Users"
              detail="Add people, change what they may do, or restrict an account."
              action={<Button onClick={() => navigate('/users')}>Manage users</Button>}
            />
          )}
          {canCreateVaults && (
            <Row
              icon={<KeyRound className="size-5" />}
              title="Create a vault"
              detail="A separate set of photos with its own passphrase."
              action={<Button onClick={() => setCreatingVault(true)}>New vault</Button>}
            />
          )}
        </Section>
      )}

      <Section title="Appearance">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <p className="text-[15px] font-medium text-ink">Theme</p>
          <div role="radiogroup" aria-label="Theme" className="flex rounded-lg border border-line p-0.5">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => setTheme(option.value)}
                className={clsx(
                  'h-8 rounded-md px-3 text-sm transition-colors',
                  theme === option.value ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-accent-soft',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {MULTI_SERVER && (
        <Section title="Accounts">
          {savedAccounts.map((account) => (
            <Row
              key={account.id}
              icon={<UserRound className="size-5" />}
              title={account.username}
              detail={`${hostOf(account.serverUrl)}${
                account.id === activeAccountId ? ' · Active' : account.signedIn ? '' : ' · Sign in required'
              }`}
              action={
                <div className="flex gap-2">
                  {account.id !== activeAccountId && (
                    <Button onClick={() => void switchAccount(account.id)}>Switch</Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (window.confirm(`Remove ${account.username} on ${hostOf(account.serverUrl)} from this browser?`)) {
                        void removeAccount(account.id);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>
              }
            />
          ))}
        </Section>
      )}

      <Section title="Account">
        <Row
          icon={<LogOut className="size-5 text-danger" />}
          title="Logout"
          detail={`Signed in as ${user?.username ?? ''}${user?.role === 'owner' ? ' (owner)' : ''}. Signs out here and clears all local data.`}
          action={
            <Button
              variant="danger"
              loading={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut();
              }}
            >
              Logout
            </Button>
          }
        />
      </Section>

      {isCreator && (
        <ShareDialog open={sharing} onOpenChange={setSharing} target={{ kind: 'vault', id: vaultId, name: vaultLabel }} />
      )}
      <CreateVaultDialog
        open={creatingVault}
        onOpenChange={setCreatingVault}
        onCreated={(vault) => {
          // Another vault is open; drop the new one's key rather than switching silently
          discardVaultMatches();
          toast(`Created ${vault.label}. Close this vault and enter its passphrase to open it.`);
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
    </section>
  );
}

function Row({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <span className="shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink">{title}</p>
        <p className="text-[13px] text-muted">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
