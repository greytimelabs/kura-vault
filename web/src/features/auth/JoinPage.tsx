import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import { EMPTY_SECRETS, SecretsFields, secretsValid } from './SecretsFields';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/lib/api/client';
import type { InviteInfo } from '@/lib/api/types';
import { MULTI_SERVER } from '@/lib/config';
import { decodeInviteLink, type InviteLink } from '@/lib/invite';
import { hostOf } from '@/lib/serverUrl';
import { acceptInvite, checkServer, readInvite, signOut } from '@/lib/session';
import { useAuthStore } from '@/state/authStore';

type State =
  | { step: 'loading' }
  | { step: 'invalid'; message: string }
  | { step: 'ready'; invite: InviteLink; info: InviteInfo; serverUrl?: string };

/**
 * Where an invite link lands. The link's fragment (never sent to any server)
 * carries the secret that proves this person's new keys to the owner, and the
 * owner's key that this account will trust from now on.
 */
export function JoinPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  // Read once: the fragment is removed from the address bar below
  const fragment = useMemo(() => hash.replace(/^#/, ''), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, setState] = useState<State>({ step: 'loading' });
  const [secrets, setSecrets] = useState(EMPTY_SECRETS);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const invite = decodeInviteLink(fragment);
      let serverUrl: string | undefined;
      if (MULTI_SERVER) {
        if (!invite.server) throw new Error('This invite does not say which server it is for.');
        serverUrl = await checkServer(invite.server);
      }
      const { info } = await readInvite(invite, serverUrl);
      // Keep the secret out of the address bar, history and any screenshot
      window.history.replaceState(window.history.state, '', window.location.pathname);
      if (!cancelled) setState({ step: 'ready', invite, info, serverUrl });
    })().catch((err: unknown) => {
      if (cancelled) return;
      const status = (err as { status?: number }).status;
      setState({
        step: 'invalid',
        message:
          status === 404
            ? 'This invite has expired or was already used. Ask the owner for a new one.'
            : err instanceof Error
              ? err.message
              : 'This invite could not be opened.',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fragment]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.step !== 'ready') return;
    setTouched(true);
    if (!secretsValid(secrets)) return;
    setBusy(true);
    setError(null);
    try {
      // Someone else may be signed in on this browser
      if (useAuthStore.getState().status === 'authenticated') await signOut();
      await acceptInvite({
        invite: state.invite,
        password: secrets.password,
        passphrase: secrets.passphrase,
        serverUrl: state.serverUrl,
      });
      setSecrets(EMPTY_SECRETS);
      navigate('/unlock', { replace: true });
    } catch (err) {
      setError(errorMessage(err, err instanceof Error ? err.message : 'Could not create the account'));
      setBusy(false);
    }
  };

  if (state.step === 'loading') {
    return (
      <AuthLayout title="Kura Vault" subtitle="Opening your invite">
        <div className="flex justify-center py-6 text-muted">
          <Spinner label="Opening invite" />
        </div>
      </AuthLayout>
    );
  }

  if (state.step === 'invalid') {
    return (
      <AuthLayout title="Kura Vault" subtitle="Invite">
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Join Kura Vault"
      subtitle={state.serverUrl ? `Set up your account on ${hostOf(state.serverUrl)}` : 'Set up your account'}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="rounded-lg border border-line px-3 py-2 text-sm">
          <span className="block text-[13px] text-muted">Username</span>
          <span className="block truncate font-medium text-ink" data-testid="join-username">
            {state.info.username}
          </span>
        </p>
        {/* Lets a password manager file the new password under the right name */}
        <input type="text" name="username" autoComplete="username" value={state.info.username} readOnly hidden />
        <SecretsFields value={secrets} onChange={setSecrets} touched={touched} disabled={busy} />
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
