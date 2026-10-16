'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreateLinkShortcut } from '@/components/create-link-shortcut';

const CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@go.arjav.is-cool.dev';

export default function AppShell({
  email,
  children
}: {
  email: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const nav = email
    ? [
        { href: '/dashboard', label: 'Links' },
        { href: '/links/new', label: 'New' },
        { href: '/tags', label: 'Organize' },
        { href: '/settings', label: 'Settings' }
      ]
    : [{ href: '/login', label: 'Sign in' }];

  const isMarketing = pathname === '/' || pathname === '/privacy' || pathname === '/terms' || pathname === '/docs';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
          <Link
            href="/"
            className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
            aria-label="go. home"
          >
            <span
              aria-hidden
              className="grid h-5 w-5 place-items-center rounded-[5px] bg-[var(--fg)] text-[10px] font-bold text-[var(--bg)]"
            >
              g
            </span>
            <span>go.</span>
          </Link>

          {email ? (
            <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
              {nav.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                      active
                        ? 'bg-[var(--surface)] font-medium text-[var(--fg)]'
                        : 'text-[var(--muted)] hover:text-[var(--fg)]'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            {email ? (
              <>
                <CreateLinkShortcut />
                <Link href="/links/new" className="btn btn-primary hidden sm:inline-flex">
                  New link
                </Link>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="btn btn-ghost">
                    Sign out
                  </button>
                </form>
              </>
            ) : isMarketing ? (
              <Link href="/login" className="btn btn-primary">
                Sign in
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-[var(--muted)]">
          <span className="font-medium text-[var(--fg)]">go.</span> — privately operated on a
          single domain.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <Link href="/privacy" className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
            Privacy
          </Link>
          <Link href="/terms" className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
            Terms
          </Link>
          <Link href="/docs" className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]">
            Docs
          </Link>
          <Link
            href="/api/health"
            className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            Status
          </Link>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}