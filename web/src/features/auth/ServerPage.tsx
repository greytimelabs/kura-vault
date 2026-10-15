import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { AccountMenu } from '../shell/AccountMenu';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { checkServer, loginPath, serverNeedsSetup } from '@/lib/session';
import { useAccountStore } from '@/state/accountStore';

/** Multi-server only. First step of signing in: which server to talk to. */
export function ServerPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const adding = params.get('add') === '1';
  const hasAccounts = useAccountStore((s) => s.accounts.length > 0);
  const [address, setAddress] = useState(params.get('url') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const serverUrl = await checkServer(address);
      // A server with no owner yet goes to first-run setup instead of sign-in
      navigate(
        (await serverNeedsSetup(serverUrl))
          ? `/setup?${new URLSearchParams({ server: serverUrl })}`
          : loginPath(serverUrl, { add: adding }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={adding ? 'Add account' : 'Kura Vault'}
      subtitle="Enter the address of your Kura Vault server"
      footer={
        <div className="space-y-3">
          {hasAccounts && (
            <div className="flex items-center justify-center gap-2">
              Saved accounts <AccountMenu />
            </div>
          )}
          <Link to="/privacy" className="hover:text-ink">
            Privacy policy
          </Link>
        </div>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="Server URL"
          name="server"
          type="url"
          inputMode="url"
          placeholder="https://vault.example.com"
          autoComplete="url"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          error={error}
          autoFocus
        />
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Connect
        </Button>
      </form>
    </AuthLayout>
  );
}
