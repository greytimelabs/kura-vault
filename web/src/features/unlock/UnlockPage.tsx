import { Folder } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CreateVaultDialog } from './CreateVaultDialog';
import { AuthLayout } from '../auth/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import type { VaultMatch } from '@/lib/crypto/protocol';
import { discardVaultMatches, findVaultMatches, openVault, signOut } from '@/lib/session';
import { useAuthStore, useIsOwner } from '@/state/authStore';

export function UnlockPage() {
  const isOwner = useIsOwner();
  const deviceId = useAuthStore((s) => s.user?.deviceId);
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

  return (
    <AuthLayout
      title="Enter Passphrase"
      subtitle="Your photos are decrypted only on this device"
      footer={
        <div className="space-y-2">
          {isOwner && (
            <p>
              <button type="button" onClick={() => setCreating(true)} className="font-medium text-accent hover:underline">
                Create a vault
              </button>
            </p>
          )}
          <p>
            Signed in as {deviceId} ·{' '}
            <button type="button" onClick={() => void signOut()} className="font-medium text-accent hover:underline">
              Logout
            </button>
          </p>
        </div>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          ref={inputRef}
          label="Vault passphrase"
          secret
          // Not a login: keep password managers from saving or filling it
          autoComplete="off"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          error={error}
          disabled={busy}
          autoFocus
        />
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Unlock
        </Button>
      </form>

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
