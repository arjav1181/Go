'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreateLinkShortcut } from '@/components/create-link-shortcut';

export default function AppShell({
  email,
  children
}: {
  email: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const links = email
    ? [
        { href: '/dashboard', label: 'Dashboard' },
        { href: '/links/new', label: 'New link' },
        { href: '/tags', label: 'Tags' },
        { href: '/settings', label: 'Settings' },
        { href: '/privacy', label: 'Privacy' }
      ]
    : [
        { href: '/login', label: 'Sign in' },
        { href: '/privacy', label: 'Privacy' }
      ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">go.</Link>
          <nav className="flex items-center gap-3 text-sm" aria-label="Main">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
                className={pathname === link.href ? 'font-semibold text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'}
              >
                {link.label}
              </Link>
            ))}
            {email ? (
              <>
                <CreateLinkShortcut />
                <form action="/auth/signout" method="post">
                  <button type="submit" className="text-[var(--muted)] hover:text-[var(--fg)]">Sign out</button>
                </form>
              </>
            ) : null}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@go.arjav.is-cool.dev';

function SiteFooter() {
  return (
    <footer className="mt-8 border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-mono text-[var(--fg)]">go.</span> — operated privately on a single
          domain.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-4">
          <Link href="/privacy" className="hover:text-[var(--fg)]">Privacy</Link>
          <Link href="/terms" className="hover:text-[var(--fg)]">Terms</Link>
          <Link href="/docs" className="hover:text-[var(--fg)]">Docs</Link>
          <Link href="/api/health" className="hover:text-[var(--fg)]">Status</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[var(--fg)]">Contact</a>
        </nav>
      </div>
    </footer>
  );
}