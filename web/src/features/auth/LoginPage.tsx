import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { AccountMenu } from '../shell/AccountMenu';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { errorMessage } from '@/lib/api/client';
import { MULTI_SERVER } from '@/lib/config';
import { hostOf } from '@/lib/serverUrl';
import { serverNeedsSetup, signIn } from '@/lib/session';
import { useAccountStore } from '@/state/accountStore';
import { rememberedUsername } from '@/state/preferences';

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Multi-server: the server chosen on the previous screen, and for a saved
  // account whose login expired, its username
  const serverUrl = MULTI_SERVER ? params.get('server') : null;
  const savedUsername = MULTI_SERVER ? params.get('username') : null;
  const hasAccounts = useAccountStore((s) => s.accounts.length > 0);
  const [username, setUsername] = useState(() => (MULTI_SERVER ? (savedUsername ?? '') : rememberedUsername.get()));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // A server with no owner yet has nobody to sign in as
  useEffect(() => {
    let cancelled = false;
    if (MULTI_SERVER && !serverUrl) return;
    void serverNeedsSetup(serverUrl ?? undefined).then((needed) => {
      if (needed && !cancelled) navigate(`/setup${serverUrl ? `?${new URLSearchParams({ server: serverUrl })}` : ''}`, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [serverUrl, navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!username.trim() || !password) return;

    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password, serverUrl ?? undefined);
      // The router moves on to the passphrase screen once the session exists;
      // when adding an account a session already existed, so say it outright
      if (MULTI_SERVER) navigate('/unlock', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
      setBusy(false);
    }
  };

  if (MULTI_SERVER && !serverUrl) return <Navigate to="/server" replace />;
  return (
    <AuthLayout
      title="Kura Vault"
      subtitle="Sign in to your account"
      footer={
        <div className="space-y-2">
          <p>Accounts are created by the server owner. Open the invite link they sent you to join.</p>
          {MULTI_SERVER && hasAccounts && (
            <div className="flex items-center justify-center gap-2">
              Saved accounts <AccountMenu />
            </div>
          )}
        </div>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {serverUrl && (
          <p className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block text-[13px] text-muted">Server</span>
              <span className="block truncate font-medium text-ink" data-testid="login-server">
                {hostOf(serverUrl)}
              </span>
            </span>
            <Link
              to={`/server?${new URLSearchParams({ url: serverUrl, ...(params.get('add') ? { add: '1' } : {}) }).toString()}`}
              className="shrink-0 font-medium text-accent hover:underline"
            >
              Change
            </Link>
          </p>
        )}
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          readOnly={Boolean(savedUsername)}
          error={touched && !username.trim() ? 'Required' : null}
          autoFocus={!username}
        />
        <Field
          label="Password"
          name="password"
          secret
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={touched && !password ? 'Required' : null}
          autoFocus={Boolean(username)}
        />
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Login
        </Button>
      </form>
    </AuthLayout>
  );
}
