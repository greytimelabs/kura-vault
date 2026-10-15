import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KuraMark } from '@/components/brand/KuraMark';

export const CONTACT_EMAIL = 'contact@greytimelabs.com';

/** A readable page of policy text, open to everyone, signed in or not. */
export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-bg px-4 py-10">
      <article className="mx-auto max-w-2xl">
        <header className="mb-8">
          <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-ink">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
              <KuraMark className="size-[18px]" />
            </span>
            Kura Vault
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
        </header>
        <div className="space-y-8 text-[15px] leading-relaxed text-ink">{children}</div>
        <footer className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-6 text-sm text-muted">
          <Link to="/privacy" className="hover:text-ink">
            Privacy policy
          </Link>
          <Link to="/delete-account" className="hover:text-ink">
            Delete your account
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink">
            {CONTACT_EMAIL}
          </a>
        </footer>
      </article>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-muted">{children}</ul>;
}

export function ContactLink() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-accent underline underline-offset-2">
      {CONTACT_EMAIL}
    </a>
  );
}
