import { clsx } from 'clsx';

/** The Kura Vault logo mark in the current text colour. Geometry from branding/tools/mark.mjs. */
export function KuraMark({ className }: { className?: string }) {
  return (
    <svg className={clsx(className ?? 'size-5')} viewBox="164 164 696 696" fill="currentColor" aria-hidden>
      <path d="M484 200H540Q616 318 836 362V418H188V362Q408 318 484 200Z" />
      <path fillRule="evenodd" d="M264 446H760V824H264ZM484 663.5A72 72 0 1 1 540 663.5L568 764H456Z" />
    </svg>
  );
}
