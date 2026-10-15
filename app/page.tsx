import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'go. — short links on a domain you own',
  description:
    'Memorable short links on your own domain. Aggregate analytics that store no IP addresses, ' +
    'no cookies and no visitor identifiers. Scheduled destinations, weighted redirects and a scoped API.'
};

function Section({
  children,
  className = '',
  id
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`border-t border-[var(--border)] px-4 py-14 ${className}`}>
      {children}
    </section>
  );
}

function Feature({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <h3 className="font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{children}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="-mx-4 -mt-8">
      {/* Hero */}
      <section className="px-4 pb-16 pt-10 sm:pt-20">
        <p className="font-mono text-sm tracking-tight text-[var(--muted)]">go.</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Short links on a domain you own, with analytics that forget who clicked.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
          Create memorable links like <code className="font-mono">/launch</code>, change where they
          point without changing the link, and see aggregate counts — never an IP address, never a
          cookie, never a fingerprint.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-white transition hover:opacity-90"
          >
            Owner sign in
          </Link>
          <a
            href="#how-it-works"
            className="rounded-lg border border-[var(--border)] px-5 py-2.5 font-medium transition hover:bg-[var(--card)]"
          >
            How it works
          </a>
        </div>
        <p className="mt-4 text-sm text-[var(--muted)]">
          Access is restricted to the account owner. There is no public sign-up.
        </p>
      </section>

      {/* What it is */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight">A short link is a redirect you control</h2>
          <p className="mt-4 leading-relaxed text-[var(--muted)]">
            You choose a slug. Visitors who open <code className="font-mono">go.arjav.is-cool.dev/launch</code>{' '}
            are sent straight to the current destination with a single HTTP <code className="font-mono">302</code>.
            Nothing is rendered in between, no interstitial, no tracking script, no wait.
          </p>
          <p className="mt-4 leading-relaxed text-[var(--muted)]">
            Because the link is yours rather than a shared platform&apos;s, the destination can change
            tomorrow without reprinting a QR code, and a link you no longer want can be disabled
            without leaving anything behind on someone else&apos;s infrastructure.
          </p>
        </div>
      </Section>

      {/* Product preview */}
      <Section className="bg-[var(--card)]">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight">Your links, at a glance</h2>
          <p className="mt-2 text-[var(--muted)]">
            Every link shows its live destination, its state and its aggregate clicks.
          </p>

          <div className="mt-6 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]">
              <span className="font-mono text-sm font-medium">/launch</span>
              <span className="hidden truncate font-mono text-xs text-[var(--muted)] sm:block">
                https://example.com/blog/announcing
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-[var(--muted)]">1,284</span>
                <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                  Live
                </span>
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]">
              <span className="font-mono text-sm font-medium">/docs</span>
              <span className="hidden truncate font-mono text-xs text-[var(--muted)] sm:block">
                https://example.com/docs
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-[var(--muted)]">617</span>
                <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                  Live
                </span>
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]">
              <span className="font-mono text-sm font-medium">/promo</span>
              <span className="hidden truncate font-mono text-xs text-[var(--muted)] sm:block">
                https://example.com/sale
              </span>
              <span className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-[var(--muted)]">0</span>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                  Paused
                </span>
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Features */}
      <Section>
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold tracking-tight">What it actually does</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Feature title="Custom aliases">
              Choose any lowercase slug you want, or let one be generated. Slugs that would collide
              with an application route are rejected so a link can never be silently shadowed.
            </Feature>
            <Feature title="Change destinations, keep the link">
              Repoint an existing link at any time. The short URL never changes, so anything already
              printed or shared keeps working.
            </Feature>
            <Feature title="Scheduled and conditional redirects">
              Point a link at different destinations during defined time windows, and route by
              conditions such as country or device category.
            </Feature>
            <Feature title="Weighted A/B redirects">
              Split traffic between variants by weight. Bucketing is a hash of the link and a
              server-side salt, so it is deterministic and reproducible without storing anything
              about the visitor.
            </Feature>
            <Feature title="QR codes, generated here">
              Previews and downloads come from the same owner-gated endpoint and are rendered
              locally. No third-party QR service ever sees your link.
            </Feature>
            <Feature title="Tags, folders and CSV export">
              Organise links privately, then export aggregate click history. Exports are built
              server-side and formula-injection safe.
            </Feature>
            <Feature title="Aggregate analytics">
              Clicks by UTC day, referrer hostname only, and a coarse device category. Counts are
              clicks, not people, and the page says so.
            </Feature>
            <Feature title="A scoped API">
              Create and manage links with API keys that carry explicit read/write scopes, can be
              rotated, and stop working the moment they are revoked.
            </Feature>
          </div>
        </div>
      </Section>

      {/* How it works */}
      <Section className="bg-[var(--card)]" id="how-it-works">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-6 space-y-6">
            {[
              {
                n: '1',
                t: 'A request arrives',
                d: 'go.arjav.is-cool.dev/launch is requested by a visitor’s browser or by any client at all. The slug is looked up in one database query along with any schedule, rules and variants that apply.'
              },
              {
                n: '2',
                t: 'The destination is resolved',
                d: 'Expiry, activation, schedule windows and conditional rules are evaluated. If an experiment is running, the variant is chosen by hashing the link ID — never the visitor.'
              },
              {
                n: '3',
                t: 'A 302 is returned immediately',
                d: 'The response goes out before analytics are written. If recording the click fails, the redirect still succeeds; the failure is logged instead.'
              }
            ].map((step) => (
              <li key={step.n} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] font-mono text-sm">
                  {step.n}
                </span>
                <div>
                  <h3 className="font-semibold">{step.t}</h3>
                  <p className="mt-1 leading-relaxed text-[var(--muted)]">{step.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Privacy */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight">What this service does not store</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              'IP addresses',
              'Analytics cookies',
              'Raw User-Agent strings',
              'Browser fingerprints',
              'Full referrer URLs',
              'Cross-site visitor identifiers'
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-4 py-3">
                <span aria-hidden className="text-[var(--muted)]">
                  ✕
                </span>
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 leading-relaxed text-[var(--muted)]">
            That is a real engineering decision with real consequences: there is no visitor-level
            record to subpoena, and no way to attribute abuse to an individual. Rate limiting uses a
            hash of the connecting address, which is a brake rather than an identity. The{' '}
            <Link href="/privacy" className="underline underline-offset-4">
              privacy page
            </Link>{' '}
            describes the behaviour precisely.
          </p>
        </div>
      </Section>

      {/* CTA */}
      <Section className="bg-[var(--card)]">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Owner access</h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--muted)]">
            Sign-in is restricted to an explicit email allowlist. If you are not on it, there is
            nothing to sign up for.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-[var(--accent)] px-5 py-2.5 font-medium text-white transition hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </Section>
    </div>
  );
}
