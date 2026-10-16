import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'go. — short links on a domain you own',
  description:
    'Memorable short links on your own domain. Aggregate analytics that store no IP addresses, ' +
    'no cookies and no visitor identifiers. Scheduled destinations, weighted redirects and a scoped API.'
};

function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 ${className}`}>{children}</div>;
}

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Custom aliases',
    body: 'Choose any lowercase slug, or let one be generated. Slugs that would collide with an application route are rejected, so a link can never be silently shadowed.'
  },
  {
    title: 'Change destination, keep the link',
    body: 'Repoint a link at any time. The short URL never changes, so anything already printed or shared keeps working.'
  },
  {
    title: 'Scheduled redirects',
    body: 'Point a link at different destinations during defined time windows, and route conditionally by country or device category.'
  },
  {
    title: 'Weighted A/B redirects',
    body: 'Split traffic by weight. Bucketing hashes the link with a server-side salt, so it is deterministic and reproducible without storing anything about the visitor.'
  },
  {
    title: 'QR codes, generated here',
    body: 'Preview and download come from the same owner-gated endpoint and render locally. No third-party QR service ever sees your link.'
  },
  {
    title: 'Tags, folders, CSV export',
    body: 'Organise links privately, then export aggregate click history. Exports are built server-side and formula-injection safe.'
  },
  {
    title: 'Aggregate analytics',
    body: 'Clicks by UTC day, referrer hostname only, and a coarse device category. Counts are clicks, not people, and the page says so.'
  },
  {
    title: 'A scoped API',
    body: 'Create and manage links with API keys carrying explicit read/write scopes. Rotatable, and revoked the moment you delete them.'
  }
];

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'A request arrives',
    body: 'go.arjav.is-cool.dev/launch is requested by a browser or any client. The slug is resolved in one database query along with any schedule, rules and variants that apply.'
  },
  {
    title: 'The destination is resolved',
    body: 'Expiry, activation, schedule windows and conditional rules are evaluated. If an experiment is running, the variant is chosen by hashing the link id — never the visitor.'
  },
  {
    title: 'A 302 is returned immediately',
    body: 'The response is sent before analytics are written. If recording a click fails, the redirect still succeeds and the failure is logged instead.'
  }
];

const NOT_STORED = [
  'IP addresses',
  'Analytics cookies',
  'Raw User-Agent strings',
  'Browser fingerprints',
  'Full referrer URLs',
  'Cross-site visitor identifiers'
];

export default function HomePage() {
  return (
    <div className="-mx-5 -mt-14">
      {/* Hero */}
      <Container className="pb-24 pt-20 sm:pt-28">
        <div className="max-w-3xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[12px] text-[var(--muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" aria-hidden />
            Owner-operated · no tracking
          </p>

          <h1 className="text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
            Short links on a domain you own, with analytics that forget who clicked.
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
            Create memorable links like{' '}
            <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--fg)]">
              /launch
            </code>
            , change where they point without changing the link, and see aggregate counts — never an
            IP address, never a cookie, never a fingerprint.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn btn-primary h-10 px-5 text-[15px]">
              Owner sign in
            </Link>
            <Link href="/docs" className="btn btn-secondary h-10 px-5 text-[15px]">
              Read the docs
            </Link>
          </div>

          <p className="mt-5 text-[13px] text-[var(--subtle)]">
            Access is restricted to an explicit email allowlist. There is no public sign-up.
          </p>
        </div>
      </Container>

      {/* Product preview */}
      <div className="border-y border-[var(--border)] bg-[var(--surface)]">
        <Container className="py-20">
          <h2 className="text-2xl font-semibold tracking-tight">Your links, at a glance</h2>
          <p className="mt-2 text-[var(--muted)]">
            Every link shows its live destination, its state and its aggregate clicks.
          </p>

          <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]">
            <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-[var(--border)] px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
              <span className="font-mono text-[13px] font-medium">/launch</span>
              <span className="hidden truncate font-mono text-[13px] text-[var(--muted)] sm:block">
                https://example.com/blog/announcing
              </span>
              <span className="flex items-center gap-3">
                <span className="text-[13px] tabular-nums text-[var(--muted)]">1,284</span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" aria-hidden />
                  Live
                </span>
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-[var(--border)] px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
              <span className="font-mono text-[13px] font-medium">/docs</span>
              <span className="hidden truncate font-mono text-[13px] text-[var(--muted)] sm:block">
                https://example.com/docs
              </span>
              <span className="flex items-center gap-3">
                <span className="text-[13px] tabular-nums text-[var(--muted)]">617</span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" aria-hidden />
                  Live
                </span>
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
              <span className="font-mono text-[13px] font-medium">/promo</span>
              <span className="hidden truncate font-mono text-[13px] text-[var(--muted)] sm:block">
                https://example.com/sale
              </span>
              <span className="flex items-center gap-3">
                <span className="text-[13px] tabular-nums text-[var(--muted)]">0</span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--subtle)]" aria-hidden />
                  Paused
                </span>
              </span>
            </div>
          </div>
        </Container>
      </div>

      {/* What it is */}
      <Container className="py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">
            A short link is a redirect you control
          </h2>
          <p className="prose-muted mt-4">
            You choose a slug. Visitors who open{' '}
            <code className="rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--fg)]">
              go.arjav.is-cool.dev/launch
            </code>{' '}
            are sent straight to the current destination with a single HTTP 302. Nothing is
            rendered in between, no interstitial, no tracking script, no wait.
          </p>
          <p className="prose-muted mt-4">
            Because the link is yours rather than a shared platform&rsquo;s, the destination can
            change tomorrow without reprinting a QR code, and a link you no longer want can be
            disabled without leaving anything behind on someone else&rsquo;s infrastructure.
          </p>
        </div>
      </Container>

      {/* Features */}
      <div className="border-y border-[var(--border)] bg-[var(--surface)]">
        <Container className="py-20">
          <h2 className="text-2xl font-semibold tracking-tight">What it actually does</h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="bg-[var(--bg)] p-6">
                <h3 className="text-[15px] font-medium">{feature.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </div>

      {/* How it works */}
      <Container className="py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-10 space-y-8">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-5">
                <span
                  aria-hidden
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--border)] font-mono text-[11px] text-[var(--muted)]"
                >
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>

      {/* Privacy */}
      <div className="border-y border-[var(--border)] bg-[var(--surface)]">
        <Container className="py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight">
              What this service does not store
            </h2>
            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {NOT_STORED.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3"
                >
                  <span aria-hidden className="text-[var(--subtle)]">
                    ✕
                  </span>
                  <span className="text-[13px]">{item}</span>
                </div>
              ))}
            </div>
            <p className="prose-muted mt-8">
              That is a real engineering decision with real consequences: there is no visitor-level
              record to subpoena, and no way to attribute abuse to an individual. Rate limiting uses
              a hash of the connecting address, which is a brake rather than an identity. The{' '}
              <Link href="/privacy" className="link">
                privacy page
              </Link>{' '}
              describes the behaviour precisely.
            </p>
          </div>
        </Container>
      </div>

      {/* CTA */}
      <Container className="py-24 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Owner access</h2>
        <p className="mx-auto mt-3 max-w-md text-[var(--muted)]">
          Sign-in is restricted to an explicit email allowlist. If you are not on it, there is
          nothing to sign up for.
        </p>
        <Link href="/login" className="btn btn-primary mt-7 h-10 px-5 text-[15px]">
          Sign in
        </Link>
      </Container>
    </div>
  );
}