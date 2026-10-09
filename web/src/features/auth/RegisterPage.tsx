import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { errorMessage } from '@/lib/api/client';
import { authApi } from '@/lib/api/endpoints';
import { signIn } from '@/lib/session';
import { toast } from '@/state/toastStore';

// Mirrors backend/src/modules/auth/dto/register-device.dto.ts so problems show before submitting
const PASSWORD_RULES: { test(value: string): boolean; message: string }[] = [
  { test: (v) => v.length >= 12, message: 'At least 12 characters' },
  { test: (v) => /[a-z]/.test(v), message: 'A lowercase letter' },
  { test: (v) => /[A-Z]/.test(v), message: 'An uppercase letter' },
  { test: (v) => /\d/.test(v), message: 'A number' },
  { test: (v) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(v), message: 'A special character' },
];

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const unmet = PASSWORD_RULES.filter((rule) => !rule.test(password));
  const passwordError = touched && unmet.length > 0 ? `Needs: ${unmet.map((r) => r.message.toLowerCase()).join(', ')}` : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!name.trim() || !deviceId.trim() || unmet.length > 0) return;

    setBusy(true);
    setError(null);
    try {
      await authApi.register({
        name: name.trim(),
        deviceId: deviceId.trim(),
        password,
        ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
      });
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
      setBusy(false);
      return;
    }

    try {
      await signIn(deviceId.trim(), password);
    } catch {
      // Registered, but signing in failed (network blip): let them sign in by hand
      toast('Device registered. Sign in to continue.');
      navigate('/login', { replace: true });
    }
  };

  return (
    <AuthLayout
      title="Register this device"
      subtitle="Each device has its own ID and password"
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="Device name"
          placeholder="Office laptop"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          autoComplete="off"
          error={touched && !name.trim() ? 'Required' : null}
          autoFocus
        />
        <Field
          label="Device ID"
          name="username"
          hint="What you will type to sign in on this device"
          value={deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
          maxLength={255}
          autoComplete="username"
          error={touched && !deviceId.trim() ? 'Required' : null}
        />
        <Field
          label="Password"
          name="new-password"
          secret
          hint="12+ characters with upper and lower case, a number and a symbol. Not the vault passphrase."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          maxLength={128}
          autoComplete="new-password"
          error={passwordError}
        />
        <Field
          label="Invite code"
          hint="From the vault owner. Leave empty only when setting up the very first device."
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
          autoComplete="off"
        />
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Register
        </Button>
      </form>
    </AuthLayout>
  );
}
