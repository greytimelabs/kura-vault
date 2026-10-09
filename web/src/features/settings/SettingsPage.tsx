import { clsx } from 'clsx';
import { KeyRound, Lock, LogOut, Trash2, UserPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { InviteDialog } from './InviteDialog';
import { PageHeader } from '../shell/PageHeader';
import { CreateVaultDialog } from '../unlock/CreateVaultDialog';
import { Button } from '@/components/ui/Button';
import { clearThumbUrls } from '@/lib/media/thumbLoader';
import { clearThumbStore } from '@/lib/media/thumbStore';
import { discardVaultMatches, lockVault, signOut } from '@/lib/session';
import { useAuthStore, useIsOwner } from '@/state/authStore';
import { AUTO_LOCK_OPTIONS, usePreferences, type ThemeChoice } from '@/state/preferences';
import { toast } from '@/state/toastStore';
import { useVaultId, useVaultStore } from '@/state/vaultStore';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const autoLockLabel = (minutes: number) => (minutes === 0 ? 'Never' : minutes === 60 ? '1 hour' : `${minutes} minutes`);

export function SettingsPage() {
  const vaultId = useVaultId();
  const vaultLabel = useVaultStore((s) => s.label) ?? 'this vault';
  const user = useAuthStore((s) => s.user);
  const isOwner = useIsOwner();
  const { theme, setTheme, autoLockMinutes, setAutoLockMinutes } = usePreferences();
  const [inviting, setInviting] = useState(false);
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
        <Row
          icon={<Lock className="size-5" />}
          title="Lock vault"
          detail="Wipe keys from memory. The passphrase is needed to open it again."
          action={<Button onClick={lockVault}>Lock now</Button>}
        />
        <Row
          icon={<KeyRound className="size-5" />}
          title="Lock automatically"
          detail="After this long without activity in this tab."
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

      {isOwner && (
        <Section title="Owner tools">
          <Row
            icon={<UserPlus className="size-5" />}
            title="Invite a device"
            detail={`Create a one-time code that lets a new device view ${vaultLabel}.`}
            action={<Button onClick={() => setInviting(true)}>Create code</Button>}
          />
          <Row
            icon={<KeyRound className="size-5" />}
            title="Create a vault"
            detail="A separate set of photos with its own passphrase."
            action={<Button onClick={() => setCreatingVault(true)}>New vault</Button>}
          />
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

      <Section title="Account">
        <Row
          icon={<LogOut className="size-5 text-danger" />}
          title="Logout"
          detail={`Signed in as ${user?.deviceId ?? ''} (${user?.role ?? ''}). Signs out here and clears all local data.`}
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

      <InviteDialog open={inviting} onOpenChange={setInviting} vaultId={vaultId} vaultLabel={vaultLabel} />
      <CreateVaultDialog
        open={creatingVault}
        onOpenChange={setCreatingVault}
        onCreated={(vault) => {
          // Another vault is open; drop the new one's key rather than switching silently
          discardVaultMatches();
          toast(`Created ${vault.label}. Lock this vault and enter its passphrase to open it.`);
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
