import { useRef, useState, type FormEvent } from 'react';
import { AuthLayout } from '../auth/AuthLayout';
import { AccountMenu } from '../shell/AccountMenu';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { MULTI_SERVER } from '@/lib/config';
import { signOut, unlockAccount } from '@/lib/session';
import { useAuthStore } from '@/state/authStore';

/**
 * The master passphrase. It decrypts the account's private keys inside the
 * worker; the server takes no part and cannot tell whether it was right.
 */
export function UnlockPage() {
  const username = useAuthStore((s) => s.user?.username);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (!(await unlockAccount(entered))) fail('Invalid passphrase');
    } catch (err) {
      // Wrong keys reported for this account is the one failure worth spelling out
      fail(err instanceof Error && /not yours/.test(err.message) ? err.message : 'Something went wrong');
    }
  };

  return (
    <AuthLayout
      title="Unlock"
      subtitle="Your keys are decrypted only on this device"
      footer={
        MULTI_SERVER ? (
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
        )
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          ref={inputRef}
          label="Master passphrase"
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
    </AuthLayout>
  );
}
