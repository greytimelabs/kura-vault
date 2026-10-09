import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { errorMessage } from '@/lib/api/client';

const MAX_NAME_LENGTH = 100;

interface AlbumNameDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  submitLabel: string;
  initialName?: string;
  onSubmit(name: string): Promise<void>;
}

/** Name prompt shared by "New album" and "Rename". */
export function AlbumNameDialog({ open, onOpenChange, title, submitLabel, initialName = '', onSubmit }: AlbumNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
    }
  }, [open, initialName]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the album'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description="Album names are encrypted; the server cannot read them.">
      <form onSubmit={submit} className="space-y-5">
        <Field
          label="Album name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_NAME_LENGTH}
          error={error}
          autoFocus
          autoComplete="off"
        />
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
