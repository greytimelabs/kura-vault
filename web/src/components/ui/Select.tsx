import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { forwardRef, type SelectHTMLAttributes } from 'react';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'md' | 'sm';
}

/** A native select with its own chevron. `className` lays out the wrapper. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <span className={clsx('relative inline-flex', className)}>
      <select
        ref={ref}
        className={clsx(
          'peer w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg border border-line bg-surface text-ink',
          'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
          size === 'md' ? 'h-10 pl-3 pr-9 text-sm' : 'h-8 pl-2.5 pr-8 text-[13px]',
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className={clsx(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted peer-disabled:opacity-55',
          size === 'md' ? 'right-3 size-4' : 'right-2.5 size-3.5',
        )}
      />
    </span>
  );
});
