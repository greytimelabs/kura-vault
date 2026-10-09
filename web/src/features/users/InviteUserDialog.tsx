import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { errorMessage } from '@/lib/api/client';
import type { AccessLevel } from '@/lib/api/types';
import { inviteUser } from '@/lib/session';

const USERNAME_RULE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

const LEVELS: { value: AccessLevel; label: string; detail: string }[] = [
  { value: 'limited', label: 'Limited', detail: 'Only what is shared with them.' },
  { value: 'full', label: 'Full', detail: 'Can also create private vaults of their own.' },
];

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

/** Owner: name a new user and get the link they finish setting up with. */
export function InviteUserDialog({ open, onOpenChange }: InviteUserDialogProps) {
  const [username, setUsername] = useState('');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('limited');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      // The link carries a secret: it does not outlive the dialog
      setUsername('');
      setAccessLevel('limited');
      setError(null);
      setTouched(false);
      setLink(null);
      setCopied(false);
    }
  }, [open]);

  const name = username.trim().toLowerCase();
  const valid = USERNAME_RULE.test(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      setLink(await inviteUser(name, accessLevel));
    } catch (err) {
      setError(errorMessage(err, 'Could not create the invite'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Could not copy. Select the link and copy it by hand.');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      title={link ? `Invite for ${name}` : 'Add a user'}
      description={link ? undefined : 'They choose their own password and master passphrase from the link.'}
    >
      {link ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink">
            Send this link to {name} privately. Whoever opens it first becomes {name}. It works once, for 24 hours, and
            is not shown again.
          </p>
          <textarea
            readOnly
            aria-label="Invite link"
            data-testid="invite-link"
            value={link}
            rows={4}
            onFocus={(event) => event.target.select()}
            className="w-full resize-none break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink"
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() => void copy()}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field
            label="Username"
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={touched && !valid ? '3 to 32 characters: lowercase letters, digits, dot, dash or underscore' : null}
            autoFocus
          />
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">Access</legend>
            <div className="space-y-2">
              {LEVELS.map((level) => (
                <label
                  key={level.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 has-[:checked]:border-accent"
                >
                  <input
                    type="radio"
                    name="access-level"
                    value={level.value}
                    checked={accessLevel === level.value}
                    onChange={() => setAccessLevel(level.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">{level.label}</span>
                    <span className="block text-[13px] text-muted">{level.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
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
              Create invite link
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
