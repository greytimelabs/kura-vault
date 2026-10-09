import type { ReactNode } from 'react';
import { Button } from './Button';
import { Spinner } from './Spinner';

/** Centered message for empty and error states. */
export function StateMessage({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      {icon && <div className="mb-4 text-muted">{icon}</div>}
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {detail && <p className="mt-1 max-w-sm text-sm text-muted">{detail}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry(): void }) {
  return (
    <StateMessage
      title="Could not load"
      detail={message}
      action={
        <Button variant="primary" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center text-muted">
      <Spinner className="size-7" label={label} />
    </div>
  );
}
