export const metadata = {
  title: 'Privacy',
  description:
    'What go. collects: aggregate click counts, referrer hostname only, and a coarse device ' +
    'category. No IP addresses, no cookies, no fingerprinting, no visitor identifiers.'
};

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Privacy and analytics</h1>
      <p className="text-[var(--muted)]">
        This page explains what the short link service collects. These are design choices, not a legal
        compliance guarantee.
      </p>
      <h2 className="text-lg font-semibold">What is collected</h2>
      <ul className="list-disc pl-6 text-sm text-[var(--muted)]">
        <li>Click counts, grouped by UTC day.</li>
        <li>Referrer hostname only (for example <code>example.com</code>), never the full URL or query string.</li>
        <li>Coarse device category (mobile, desktop, tablet, bot, or unknown), derived in memory from the User-Agent.</li>
      </ul>
      <h2 className="text-lg font-semibold">What is not collected</h2>
      <ul className="list-disc pl-6 text-sm text-[var(--muted)]">
        <li>IP addresses.</li>
        <li>Raw User-Agent strings.</li>
        <li>Analytics cookies, local storage, or browser fingerprinting.</li>
        <li>Full referrer URLs or query parameters.</li>
        <li>Cross-site identifiers or unique visitor labels.</li>
      </ul>
      <p className="text-sm text-[var(--muted)]">
        Counts are clicks, not unique visitors. Analytics processing never blocks a redirect.
      </p>
      <h2 className="text-lg font-semibold">Link organisation</h2>
      <p className="text-sm text-[var(--muted)]">
        Tags and folders are private, owner-only labels stored with your links. They are never
        included in redirects, in the public error pages, or in CSV exports.
      </p>
      <h2 className="text-lg font-semibold">CSV exports</h2>
      <p className="text-sm text-[var(--muted)]">
        Exports are generated on the server for signed-in owners only. They contain the same
        aggregate fields shown here — day, link, referrer hostname, device category and click
        counts — and exclude private notes and account identifiers. Values that could be
        interpreted as spreadsheet formulas are neutralised.
      </p>
    </article>
  );
}
