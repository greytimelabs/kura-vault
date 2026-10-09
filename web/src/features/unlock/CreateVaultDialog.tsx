import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { errorMessage } from '@/lib/api/client';
import type { VaultMatch } from '@/lib/crypto/protocol';
import { createVault } from '@/lib/session';

const MIN_PASSPHRASE_LENGTH = 12;

interface CreateVaultDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The new vault. Its key is held as a candidate; open it or discard it. */
  onCreated(vault: VaultMatch): void;
}

export function CreateVaultDialog({ open, onOpenChange, onCreated }: CreateVaultDialogProps) {
  const [label, setLabel] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      // Never leave a passphrase sitting in a closed dialog
      setLabel('');
      setPassphrase('');
      setConfirm('');
      setError(null);
      setTouched(false);
    }
  }, [open]);

  const tooShort = passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = passphrase !== confirm;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (tooShort || mismatch) return;

    setBusy(true);
    setError(null);
    try {
      const vault = await createVault(passphrase, label);
      setPassphrase('');
      setConfirm('');
      onCreated(vault);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the vault'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title="Create a vault"
      description="A vault is a separate set of photos with its own passphrase."
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="Name"
          placeholder="Family"
          hint="Encrypted. Shown only after the vault is unlocked."
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={60}
          autoComplete="off"
          autoFocus
        />
        <Field
          label="Passphrase"
          secret
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          autoComplete="new-password"
          error={touched && tooShort ? `Use at least ${MIN_PASSPHRASE_LENGTH} characters` : null}
        />
        <Field
          label="Confirm passphrase"
          secret
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          error={touched && !tooShort && mismatch ? 'Passphrases do not match' : null}
        />
        <p className="rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink">
          There is no way to recover or reset this passphrase. If it is lost, everything in the vault is lost with it.
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create vault
          </Button>
        </div>
      </form>
    </Modal>
  );
}
