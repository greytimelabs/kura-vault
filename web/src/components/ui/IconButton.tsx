import * as Tooltip from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Names the button for screen readers and is shown as the tooltip. */
  label: string;
  /** Keyboard shortcut shown beside the label in the tooltip. */
  shortcut?: string;
  tone?: 'default' | 'onDark';
  children: ReactNode;
}

export function IconButton({ label, shortcut, tone = 'default', className, children, ...rest }: IconButtonProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={clsx(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
            tone === 'onDark' ? 'text-white hover:bg-white/15' : 'text-ink hover:bg-accent-soft',
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="fade-in z-[70] flex items-center gap-2 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-lg"
        >
          {label}
          {shortcut && <kbd className="rounded bg-white/20 px-1 font-sans text-[11px]">{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
