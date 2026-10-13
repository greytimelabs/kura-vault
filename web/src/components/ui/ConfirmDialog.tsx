import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { Field } from './Field';
import { Modal } from './Modal';
import { errorMessage } from '@/lib/api/client';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  /** What will happen, in the body of the dialog. */
  children: ReactNode;
  confirmLabel: string;
  /** Something the user must type first: a name to repeat, or a passphrase to prove. */
  input?: {
    label: string;
    secret?: boolean;
    /** When set, the button stays disabled until exactly this is typed. */
    expected?: string;
  };
  /** Throw an Error to show its message and keep the dialog open. */
  onConfirm(value: string): Promise<void>;
}

/** The last question before something is erased for good. */
export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, input, onConfirm }: ConfirmDialogProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      // Never leave a passphrase sitting in a closed dialog
      setValue('');
      setError(null);
    }
  }, [open]);

  const ready = !input || (input.expected !== undefined ? value === input.expected : value.length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    const typed = value;
    setBusy(true);
    setError(null);
    if (input?.secret) setValue('');
    try {
      await onConfirm(typed);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, err instanceof Error ? err.message : 'Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => !busy && onOpenChange(next)} title={title}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-2 text-sm leading-relaxed text-ink">{children}</div>
        {input && (
          <Field
            label={input.label}
            secret={input.secret}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            autoFocus
          />
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!ready}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
