'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CreateLinkShortcut } from '@/components/create-link-shortcut';
import { ThemeToggle } from '@/components/theme-toggle';

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
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * The nav is hidden below `sm`, so without this panel the owner would have no
   * navigation at all on a phone once it grew past a couple of items.
   *
   * Closing is done in each link's onClick rather than by watching pathname in
   * an effect: an effect that calls setState on every navigation re-renders the
   * whole shell on every page change, and the click already knows when the
   * navigation happened.
   */
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const nav = email
    ? [
        { href: '/dashboard', label: 'Links' },
        { href: '/links/new', label: 'New' },
        { href: '/qr', label: 'QR Codes' },
        { href: '/campaigns', label: 'Campaigns' },
        { href: '/tags', label: 'Organize' },
        { href: '/settings', label: 'Settings' }
      ]
    // Logged out: informational pages only. Sign-in lives in the header action
    // area as a button — listing it here too rendered it twice.
    : [
        { href: '/docs', label: 'Docs' },
        { href: '/privacy', label: 'Privacy' },
        { href: '/terms', label: 'Terms' }
      ];


  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-[var(--ds-gray-400)] bg-[var(--ds-background-100)]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-5">
          <Link
            href="/"
            className="flex items-center gap-2 text-heading-16 text-primary"
            aria-label="go. home"
          >
            <span
              aria-hidden
              className="grid h-5 w-5 place-items-center rounded-[5px] bg-[var(--ds-gray-1000)] font-mono text-[10px] font-bold text-[var(--ds-background-100)]"
            >
              g
            </span>
            <span>go.</span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
              {nav.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`rounded-md px-2.5 py-1.5 text-label-14 transition-colors ${
                      active
                        ? 'bg-[var(--ds-gray-100)] text-primary'
                        : 'text-secondary hover:text-primary'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {email ? (
              <>
                <CreateLinkShortcut />

            <button
              type="button"
              className="btn btn-ghost btn-icon sm:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span aria-hidden>{menuOpen ? '\u2715' : '\u2630'}</span>
            </button>

            <Link href="/links/new" className="btn btn-primary hidden sm:inline-flex">
              New link
            </Link>
                <form action="/auth/signout" method="post" className="hidden sm:block">
                  <button type="submit" className="btn btn-ghost">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              // Logged out, the only route into the product is /login, and it
              // has to be reachable on every screen size. It was `hidden
              // sm:inline-flex` while the mobile menu existed only for signed-in
              // users, which left phone visitors with no way in at all.
              <Link href="/login" className="btn btn-ghost">
                Sign in
              </Link>
            )}

            <ThemeToggle />
          </div>

          {/* Mobile navigation. The desktop nav is display:none below sm, so
              without this panel the app has no navigation on a phone. */}
          {email && menuOpen ? (
            <nav
              id="mobile-nav"
              aria-label="Main"
              className="border-b border-[var(--ds-gray-400)] bg-[var(--ds-background-100)] sm:hidden"
            >
              <ul className="px-3 py-2">
                {nav.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={`block rounded-md px-3 py-2.5 text-label-14 ${
                          active ? 'bg-[var(--ds-gray-100)] text-primary' : 'text-secondary'
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link
                    href="/links/new"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-md px-3 py-2.5 text-label-14 text-secondary"
                  >
                    New link
                  </Link>
                </li>
              </ul>
              <form
                action="/auth/signout"
                method="post"
                className="px-3 pb-3"
                onSubmit={() => setMenuOpen(false)}
              >
                <button type="submit" className="btn btn-ghost btn-block">
                  Sign out
                </button>
              </form>
            </nav>
          ) : null}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-[var(--ds-gray-400)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-label-13 text-secondary">
          <span className="font-medium text-primary">go.</span> — privately operated on a single
          domain.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-label-13">
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