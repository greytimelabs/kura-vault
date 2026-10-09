import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { errorMessage } from '@/lib/api/client';
import { vaultApi } from '@/lib/api/endpoints';
import type { InviteResponse } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';

interface InviteDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  vaultId: string;
  vaultLabel: string;
}

export function InviteDialog({ open, onOpenChange, vaultId, vaultLabel }: InviteDialogProps) {
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInvite(null);
    setError(null);
    setCopied(false);
    vaultApi.invite(vaultId).then(
      (result) => {
        if (!cancelled) setInvite(result);
      },
      (err: unknown) => {
        if (!cancelled) setError(errorMessage(err, 'Could not create an invite code'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, vaultId]);

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied: the code is on screen and selectable
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a device"
      description={`Lets one new device register and view ${vaultLabel}.`}
    >
      {error ? (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : !invite ? (
        <div className="flex justify-center py-6 text-muted">
          <Spinner label="Creating invite code" />
        </div>
      ) : (
        <div className="space-y-4">
          <code
            data-testid="invite-code"
            className="block select-all break-all rounded-lg border border-line bg-bg p-3 font-mono text-[13px] leading-relaxed text-ink"
          >
            {invite.code}
          </code>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
            <li>Works once, and expires {formatDateTime(invite.expiresAt)}.</li>
            <li>This is the only time the code is shown.</li>
            <li>The new device also needs the vault passphrase. Share that separately.</li>
          </ul>
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Done</Button>
            <Button
              variant="primary"
              icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              onClick={() => void copy()}
            >
              {copied ? 'Copied' : 'Copy code'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
