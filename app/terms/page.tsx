import Link from 'next/link';

export const metadata = {
  title: 'Terms',
  description:
    'Terms of use for go., a short link service operated on a private domain. No warranty, no ' +
    'uptime guarantee, acceptable use, and the limits of what the service can promise.'
};

export default function TermsPage() {
  return (
    <article className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Terms of use</h1>
      <p className="text-sm text-[var(--muted)]">
        These terms describe the actual behaviour of the service. They are written to be read, and
        they do not claim protections or guarantees the service cannot provide.
      </p>

      <h2 className="text-lg font-semibold">Who this is for</h2>
      <p className="text-sm text-[var(--muted)]">
        This is a privately operated link shortener on a single domain. Access is restricted to an
        explicit email allowlist; there is no public registration and no free tier. By using it you
        confirm you are authorised to operate the links you publish.
      </p>

      <h2 className="text-lg font-semibold">Acceptable use</h2>
      <ul className="list-disc pl-6 text-sm text-[var(--muted)]">
        <li>
          Do not use short links for malware distribution, phishing, credential harvesting, or
          evasion of security controls.
        </li>
        <li>
          Do not use short links to misrepresent the destination, impersonate another party, or
          evade a platform&apos;s terms.
        </li>
        <li>
          Do not attempt to enumerate, brute-force, or deny service to the service or to other
          users. Automated bulk traffic is rate limited.
        </li>
        <li>
          Do not use the service for content that is unlawful in the jurisdiction where it is
          served.
        </li>
      </ul>
      <p className="text-sm text-[var(--muted)]">
        Links that breach these terms may be disabled without notice. The operator may decline to
        publish any link at all.
      </p>

      <h2 className="text-lg font-semibold">No warranty</h2>
      <p className="text-sm text-[var(--muted)]">
        The service is provided as-is, without warranty of any kind, express or implied, including
        fitness for a particular purpose. It has not been certified against any security or
        availability standard, and no claim of compliance with one should be inferred from its
        existence.
      </p>

      <h2 className="text-lg font-semibold">No uptime guarantee</h2>
      <p className="text-sm text-[var(--muted)]">
        There is no service level agreement and no uptime guarantee. Links may be interrupted by
        deployment, by the hosting provider, by a database outage, or by configuration changes.
        Because analytics record counts rather than a reliable delivery log, a click during an
        outage may not be recorded at all.
      </p>

      <h2 className="text-lg font-semibold">Destination content is not the operator&apos;s</h2>
      <p className="text-sm text-[var(--muted)]">
        A short link forwards to a third-party destination that the operator does not control. The
        operator does not review, endorse, host or moderate that destination, and cannot remove
        harmful content sitting behind someone else&apos;s link. Use the disable control if a link
        is misused.
      </p>

      <h2 className="text-lg font-semibold">Privacy</h2>
      <p className="text-sm text-[var(--muted)]">
        The service is built to store no IP addresses, no cookies, no fingerprinting and no
        visitor-level records. The{' '}
        <Link href="/privacy" className="underline underline-offset-4">
          privacy page
        </Link>{' '}
        describes precisely what is and is not collected. That design is a deliberate trade-off:
        abuse cannot be attributed to an individual.
      </p>

      <h2 className="text-lg font-semibold">Data</h2>
      <p className="text-sm text-[var(--muted)]">
        Aggregate click history is retained only as long as retention settings require, and may be
        purged without notice. Deleting an owner account removes its links and associated data.
        Backup and restoration procedures exist but are operator-run; see the repository&rsquo;s
        operational documentation. The operator does not warrant that any particular backup has
        been taken.
      </p>

      <h2 className="text-lg font-semibold">Limitation of liability</h2>
      <p className="text-sm text-[var(--muted)]">
        To the maximum extent permitted by law, the operator is not liable for any loss arising
        from use of, or inability to use, the service, including lost links, lost analytics, or
        reliance on a redirect&apos;s destination.
      </p>

      <h2 className="text-lg font-semibold">Changes</h2>
      <p className="text-sm text-[var(--muted)]">
        These terms may change as the service changes. The version published at this URL is the one
        that applies.
      </p>
    </article>
  );
}
