import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { errorMessage } from '@/lib/api/client';
import { signIn } from '@/lib/session';
import { rememberedDeviceId } from '@/state/preferences';

export function LoginPage() {
  const [deviceId, setDeviceId] = useState(rememberedDeviceId.get);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!deviceId.trim() || !password) return;

    setBusy(true);
    setError(null);
    try {
      await signIn(deviceId.trim(), password);
      // The router moves on to the passphrase screen once the session exists
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Kura Vault"
      subtitle="Sign in to this device's account"
      footer={
        <>
          New device?{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Register with an invite code
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="Device ID"
          name="username"
          autoComplete="username"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          error={touched && !deviceId.trim() ? 'Required' : null}
          autoFocus={!deviceId}
        />
        <Field
          label="Password"
          name="password"
          secret
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={touched && !password ? 'Required' : null}
          autoFocus={Boolean(deviceId)}
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
