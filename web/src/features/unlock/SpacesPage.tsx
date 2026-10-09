import { useQuery } from '@tanstack/react-query';
import { Folder, Images, Users } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CreateVaultDialog } from './CreateVaultDialog';
import { AuthLayout } from '../auth/AuthLayout';
import { AccountMenu } from '../shell/AccountMenu';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { MULTI_SERVER } from '@/lib/config';
import type { VaultMatch } from '@/lib/crypto/protocol';
import {
  discardVaultMatches,
  findVaultMatches,
  loadSharedSpaces,
  lockVault,
  openSharedSpace,
  openVault,
  signOut,
} from '@/lib/session';
import { useAuthStore, useCanCreateVaults, useIsOwner } from '@/state/authStore';

/**
 * Shown once the account is unlocked: what others shared with it, listed, and
 * a passphrase field for the vaults it created, which are never listed. Typing
 * a vault passphrase opens the vault it belongs to and says nothing about the rest.
 */
export function SpacesPage() {
  const isOwner = useIsOwner();
  const canCreateVaults = useCanCreateVaults();
  const username = useAuthStore((s) => s.user?.username);
  const shared = useQuery({ queryKey: ['spaces'], queryFn: loadSharedSpaces, staleTime: 0 });
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<VaultMatch[] | null>(null);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Leaving this screen without choosing must not leave verified keys behind
  useEffect(() => discardVaultMatches, []);

  const fail = (message: string) => {
    setError(message);
    setBusy(false);
    inputRef.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!passphrase || busy) return;
    const entered = passphrase;
    // Out of the field, and out of React state, before the slow work starts
    setPassphrase('');
    setBusy(true);
    setError(null);
    try {
      const found = await findVaultMatches(entered);
      if (found.length === 0) {
        // Same words whether there are no vaults or the passphrase was wrong
        fail('Invalid passphrase');
      } else if (found.length === 1) {
        // The normal case goes straight in, with no hint that a picker exists
        await openVault(found[0]!);
      } else {
        setMatches(found);
      }
    } catch {
      fail('Something went wrong');
    }
  };

  const dismissPicker = () => {
    discardVaultMatches();
    setMatches(null);
    setBusy(false);
  };

  const spaces = shared.data ?? [];

  return (
    <AuthLayout
      title="Open a vault"
      subtitle="Your photos are decrypted only on this device"
      footer={
        <div className="space-y-2">
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {canCreateVaults && (
              <button type="button" onClick={() => setCreating(true)} className="font-medium text-accent hover:underline">
                Create a vault
              </button>
            )}
            {isOwner && (
              <Link to="/users" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                <Users className="size-4" aria-hidden />
                Manage users
              </Link>
            )}
            <button type="button" onClick={lockVault} className="font-medium text-accent hover:underline">
              Lock
            </button>
          </p>
          {MULTI_SERVER ? (
            <div className="flex items-center justify-center gap-2">
              Signed in as <AccountMenu />
            </div>
          ) : (
            <p>
              Signed in as {username} ·{' '}
              <button type="button" onClick={() => void signOut()} className="font-medium text-accent hover:underline">
                Logout
              </button>
            </p>
          )}
        </div>
      }
    >
      {spaces.length > 0 && (
        <section aria-label="Shared with you" className="mb-5">
          <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Shared with you</h2>
          <ul className="-mx-2">
            {spaces.map((space) => (
              <li key={`${space.kind}:${space.id}`}>
                <button
                  type="button"
                  onClick={() => openSharedSpace(space)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent-soft"
                >
                  {space.kind === 'vault' ? (
                    <Folder className="size-5 shrink-0 text-muted" aria-hidden />
                  ) : (
                    <Images className="size-5 shrink-0 text-muted" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{space.label}</span>
                    <span className="block truncate text-[13px] text-muted">
                      {space.kind === 'vault' ? 'Vault' : 'Album'} from {space.sharedBy} ·{' '}
                      {space.permission === 'write' ? 'can add photos' : 'view only'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canCreateVaults ? (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field
            ref={inputRef}
            label="Vault passphrase"
            secret
            // Not a login: keep password managers from saving or filling it
            autoComplete="off"
            hint="Opens a vault you created."
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            error={error}
            disabled={busy}
            autoFocus
          />
          <Button type="submit" variant="primary" loading={busy} className="w-full">
            Open
          </Button>
        </form>
      ) : (
        spaces.length === 0 &&
        !shared.isPending && (
          <p className="text-center text-sm text-muted">
            Nothing has been shared with you yet. Ask the owner to share a vault or an album.
          </p>
        )
      )}

      {/* Lists only the vaults this passphrase opened: no count, no explanation */}
      <Modal open={matches !== null} onOpenChange={(open) => !open && dismissPicker()} title="Select vault">
        <ul className="-mx-2">
          {matches?.map((match) => (
            <li key={match.vaultId}>
              <button
                type="button"
                onClick={() => void openVault(match).catch(() => dismissPicker())}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-[15px] text-ink hover:bg-accent-soft"
              >
                <Folder className="size-5 shrink-0 text-muted" aria-hidden />
                <span className="truncate">{match.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <CreateVaultDialog open={creating} onOpenChange={setCreating} onCreated={(vault) => void openVault(vault)} />
    </AuthLayout>
  );
}
