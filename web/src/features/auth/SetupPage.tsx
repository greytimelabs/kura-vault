import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { EMPTY_SECRETS, SecretsFields, secretsValid } from './SecretsFields';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { errorMessage } from '@/lib/api/client';
import { MULTI_SERVER } from '@/lib/config';
import { hostOf } from '@/lib/serverUrl';
import { setupOwner } from '@/lib/session';

const USERNAME_RULE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

/** First run: the person holding the server's setup key creates the owner account. */
export function SetupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const serverUrl = MULTI_SERVER ? params.get('server') : null;
  const [setupKey, setSetupKey] = useState('');
  const [username, setUsername] = useState('');
  const [secrets, setSecrets] = useState(EMPTY_SECRETS);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = username.trim().toLowerCase();
  const usernameOk = USERNAME_RULE.test(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!setupKey.trim() || !usernameOk || !secretsValid(secrets)) return;
    setBusy(true);
    setError(null);
    try {
      await setupOwner({
        setupKey,
        username: name,
        password: secrets.password,
        passphrase: secrets.passphrase,
        serverUrl: serverUrl ?? undefined,
      });
      setSecrets(EMPTY_SECRETS);
      navigate('/unlock', { replace: true });
    } catch (err) {
      setError(errorMessage(err, err instanceof Error ? err.message : 'Setup failed'));
      setBusy(false);
    }
  };

  if (MULTI_SERVER && !serverUrl) return <Navigate to="/server" replace />;

  return (
    <AuthLayout
      title="Set up Kura Vault"
      subtitle={serverUrl ? `Create the owner account on ${hostOf(serverUrl)}` : 'Create the owner account for this server'}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="Setup key"
          name="setup-key"
          autoComplete="off"
          hint="Printed in the server's log when it started. It works once."
          value={setupKey}
          onChange={(event) => setSetupKey(event.target.value)}
          error={touched && !setupKey.trim() ? 'Required' : null}
          disabled={busy}
          autoFocus
        />
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={touched && !usernameOk ? '3 to 32 characters: lowercase letters, digits, dot, dash or underscore' : null}
          disabled={busy}
        />
        <SecretsFields value={secrets} onChange={setSecrets} touched={touched} disabled={busy} />
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Create owner account
        </Button>
      </form>
    </AuthLayout>
  );
}
