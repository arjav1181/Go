import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'go. — short links on a domain you own',
  description:
    'Memorable short links on your own domain. Aggregate analytics that store no IP addresses, ' +
    'no cookies and no visitor identifiers. Scheduled destinations, weighted redirects and a scoped API.'
};

function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-5xl px-5 ${className}`}>{children}</div>;
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-heading-32 text-primary">{children}</h2>;
}

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Custom aliases',
    body: 'Any lowercase slug you want. Slugs that would collide with an application route are rejected, so a link can never be silently shadowed.'
  },
  {
    title: 'Change destination, keep the link',
    body: 'Repoint a link at any time. The short URL never changes, so anything already printed or shared keeps working.'
  },
  {
    title: 'Scheduled redirects',
    body: 'Different destinations during defined time windows, plus conditional routing by country or device category.'
  },
  {
    title: 'Weighted A/B redirects',
    body: 'Bucketing hashes the link with a server-side salt — deterministic and reproducible, while storing nothing about the visitor.'
  },
  {
    title: 'QR codes, generated here',
    body: 'Preview and download come from the same owner-gated endpoint. No third-party QR service ever sees your link.'
  },
  {
    title: 'Tags, folders, CSV export',
    body: 'Organise links privately, then export aggregate click history. Exports are server-built and formula-injection safe.'
  },
  {
    title: 'Aggregate analytics',
    body: 'Clicks by UTC day, referrer hostname only, coarse device category. Counts are clicks, not people.'
  },
  {
    title: 'A scoped API',
    body: 'API keys carry explicit read/write scopes. Rotatable, and revoked the moment you delete them.'
  }
];

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'A request arrives',
    body: 'The slug is resolved in a single database query, along with any schedule, rules and variants that apply.'
  },
  {
    title: 'The destination is resolved',
    body: 'Expiry, activation, schedule windows and conditional rules are evaluated. If an experiment is running, the variant is chosen by hashing the link id — never the visitor.'
  },
  {
    title: 'A 302 is returned immediately',
    body: 'The response is sent before analytics are written. If recording a click fails, the redirect still succeeds and the failure is logged.'
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
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[var(--ds-gray-400)]">
        <div className="grid-guide absolute inset-0" aria-hidden />
        <Container className="relative pb-24 pt-20 sm:pb-32 sm:pt-28">
          <div className="max-w-3xl">
            <p className="mb-7 inline-flex items-center gap-2 rounded-full border border-[var(--ds-gray-400)] bg-[var(--ds-background-100)] px-3 py-1 text-label-12 text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ds-green-500)]" aria-hidden />
              Owner-operated · no tracking
            </p>

            <h1 className="text-heading-48 text-primary sm:text-heading-64">
              Short links on a domain you own.
              <span className="block text-secondary">Analytics that forget who clicked.</span>
            </h1>

            <p className="mt-8 max-w-2xl text-copy-20 text-secondary">
              Create memorable links like{' '}
              <code className="rounded bg-[var(--ds-gray-100)] px-1.5 py-0.5 font-mono text-[0.9em] text-primary">
                /launch
              </code>
              , change where they point without changing the link, and see aggregate counts — never
              an IP address, never a cookie, never a fingerprint.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link href="/docs" className="btn btn-primary btn-lg">
                Read the docs
              </Link>
            </div>
          </div>
        </Container>
      </section>

      {/* Product preview */}
      <section className="border-b border-[var(--ds-gray-400)] bg-[var(--ds-background-200)]">
        <Container className="py-20">
          <SectionHeading>Your links, at a glance</SectionHeading>
          <p className="mt-3 text-copy-14 text-secondary">
            Every link shows its live destination, its state and its aggregate clicks.
          </p>

          <div className="material-large mt-10 overflow-hidden">
            {[
              { slug: '/launch', dest: 'https://example.com/blog/announcing', clicks: '1,284', live: true },
              { slug: '/docs', dest: 'https://example.com/docs', clicks: '617', live: true },
              { slug: '/promo', dest: 'https://example.com/sale', clicks: '0', live: false }
            ].map((row) => (
              <div
                key={row.slug}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-[var(--ds-gray-400)] px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
              >
                <span className="font-mono text-label-14 text-primary">{row.slug}</span>
                <span className="hidden truncate font-mono text-label-13 text-tertiary sm:block">
                  {row.dest}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-label-13 tabular-nums text-secondary">{row.clicks}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ds-gray-400)] bg-[var(--ds-gray-100)] px-2 py-0.5 text-label-12 text-primary">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${row.live ? 'bg-[var(--ds-green-500)]' : 'bg-[var(--ds-gray-500)]'}`}
                      aria-hidden
                    />
                    {row.live ? 'Live' : 'Paused'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* What it is */}
      <section className="border-b border-[var(--ds-gray-400)]">
        <Container className="py-20">
          <div className="max-w-2xl">
            <SectionHeading>A short link is a redirect you control</SectionHeading>
            <p className="mt-5 text-copy-14 text-secondary">
              You choose a slug. Visitors who open{' '}
              <code className="rounded bg-[var(--ds-gray-100)] px-1.5 py-0.5 font-mono text-[0.9em] text-primary">
                go.arjav.is-cool.dev/launch
              </code>{' '}
              are sent straight to the current destination with a single HTTP 302. Nothing is
              rendered in between — no interstitial, no tracking script, no wait.
            </p>
            <p className="mt-4 text-copy-14 text-secondary">
              Because the link is yours rather than a shared platform&rsquo;s, the destination can
              change tomorrow without reprinting a QR code, and a link you no longer want can be
              disabled without leaving anything behind on someone else&rsquo;s infrastructure.
            </p>
          </div>
        </Container>
      </section>

      {/* Features */}
      <section className="border-b border-[var(--ds-gray-400)] bg-[var(--ds-background-200)]">
        <Container className="py-20">
          <SectionHeading>What it actually does</SectionHeading>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[var(--ds-gray-400)] bg-[var(--ds-gray-400)] sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="bg-[var(--ds-background-100)] p-6">
                <h3 className="text-heading-16 text-primary">{feature.title}</h3>
                <p className="mt-2.5 text-copy-13 text-secondary">{feature.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section className="border-b border-[var(--ds-gray-400)]">
        <Container className="py-20">
          <div className="max-w-2xl">
            <SectionHeading>How it works</SectionHeading>
            <ol className="mt-10 space-y-8">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-5">
                  <span
                    aria-hidden
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[var(--ds-gray-400)] bg-[var(--ds-gray-100)] font-mono text-label-12 text-secondary"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-heading-16 text-primary">{step.title}</h3>
                    <p className="mt-2 text-copy-13 text-secondary">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </section>

      {/* Privacy */}
      <section className="border-b border-[var(--ds-gray-400)] bg-[var(--ds-background-200)]">
        <Container className="py-20">
          <div className="max-w-2xl">
            <SectionHeading>What this service does not store</SectionHeading>
            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {NOT_STORED.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-lg border border-[var(--ds-gray-400)] bg-[var(--ds-background-100)] px-4 py-3"
                >
                  <span aria-hidden className="text-tertiary">
                    ✕
                  </span>
                  <span className="text-label-14 text-primary">{item}</span>
                </div>
              ))}
            </div>
            <p className="mt-8 text-copy-14 text-secondary">
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
      </section>

      {/* Closing note */}
      <Container className="py-24 text-center">
        <h2 className="text-heading-32 text-primary">Private by construction</h2>
        <p className="mx-auto mt-4 max-w-lg text-copy-14 text-secondary">
          There is no public sign-up. Accounts are restricted to an explicit allowlist, and the
          service stores nothing that could identify who visited a link.
        </p>
      </Container>
    </>
  );
}