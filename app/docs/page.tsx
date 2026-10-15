import Link from 'next/link';

export const metadata = {
  title: 'Documentation',
  description:
    'How go. works: short-link behaviour, the owner API, authentication and scopes, rate limits, ' +
    'error formats, and the operational endpoints.'
};

const ENDPOINTS: Array<{ method: string; path: string; scope: string; note: string }> = [
  {
    method: 'GET',
    path: '/api/v1/links',
    scope: 'links:read',
    note: 'List links owned by the authenticated owner.'
  },
  {
    method: 'POST',
    path: '/api/v1/links',
    scope: 'links:write',
    note: 'Create a link. Optional custom slug; reserved slugs are rejected.'
  },
  {
    method: 'GET',
    path: '/api/v1/links/{id}',
    scope: 'links:read',
    note: 'Fetch one link.'
  },
  {
    method: 'PATCH',
    path: '/api/v1/links/{id}',
    scope: 'links:write',
    note: 'Update destination, title, activation, expiry or tags.'
  },
  {
    method: 'DELETE',
    path: '/api/v1/links/{id}',
    scope: 'links:write',
    note: 'Delete a link and its dependent rows.'
  },
  {
    method: 'GET',
    path: '/api/v1/analytics',
    scope: 'analytics:read',
    note: 'Aggregate click counts over a date range.'
  },
  {
    method: 'GET',
    path: '/api/v1/experiments/{id}',
    scope: 'analytics:read',
    note: 'Versioned config, results, a deterministic replay and a routing check.'
  },
  {
    method: 'GET',
    path: '/api/health',
    scope: '—',
    note: 'Liveness. Constant response. Safe to expose.'
  },
  {
    method: 'GET',
    path: '/api/ready',
    scope: '—',
    note: 'Readiness. Reports database reachability and configuration booleans.'
  }
];

const ERRORS: Array<{ code: number; meaning: string }> = [
  { code: 400, meaning: 'Malformed request body, query or path parameter.' },
  { code: 401, meaning: 'Missing, malformed or revoked API key.' },
  { code: 403, meaning: 'Valid key without the required scope, or not an allowed owner.' },
  { code: 404, meaning: 'No such resource, or one owned by a different owner.' },
  { code: 409, meaning: 'Slug already taken.' },
  { code: 422, meaning: 'Well-formed but invalid, for example an unusable destination URL.' },
  { code: 429, meaning: 'Rate limited. See the Retry-After header.' },
  { code: 500, meaning: 'Unexpected server error. Detail is never included in the response.' }
];

export default function DocsPage() {
  return (
    <article className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Documentation</h1>
      <p className="text-sm text-[var(--muted)]">
        The API is for the link owner. It is not a public service and there is no public
        registration. Keys are scoped and revocable.
      </p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Authentication</h2>
        <p className="text-sm text-[var(--muted)]">
          Send an API key as a bearer token. Keys are stored only as a salted hash, so the value is
          shown once at creation and cannot be recovered afterwards.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-xs">
{`curl -H "Authorization: Bearer $GO_API_KEY" \\
  https://go.arjav.is-cool.dev/api/v1/links`}
        </pre>
        <p className="text-sm text-[var(--muted)]">
          Scopes are explicit and are never implied: a key granted{' '}
          <code className="font-mono">links:read</code> cannot create, modify or delete anything.
          Owner allowlist membership is re-checked on every request, so removing an owner from
          configuration invalidates their keys immediately.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Endpoints</h2>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--card)] text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Method</th>
                <th scope="col" className="px-3 py-2 font-medium">Path</th>
                <th scope="col" className="px-3 py-2 font-medium">Scope</th>
                <th scope="col" className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={`${e.method} ${e.path}`} className="border-t border-[var(--border)] align-top">
                  <td className="px-3 py-2 font-mono text-xs">{e.method}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.path}</td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">{e.scope}</td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Rate limits</h2>
        <p className="text-sm text-[var(--muted)]">
          Limits are counted in Postgres, so they hold across every deployed instance. A limited
          response carries <code className="font-mono">429</code>, a{' '}
          <code className="font-mono">Retry-After</code> header and the remaining budget. If the
          counter store is unreachable, nonessential paths fail open rather than break.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Errors</h2>
        <p className="text-sm text-[var(--muted)]">
          Errors use a fixed JSON envelope and never include driver messages, stack traces or row
          contents.
        </p>
        <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 text-xs">
{`{ "error": "Slug is already taken." }`}
        </pre>
        <ul className="divide-y divide-[var(--border)] text-sm">
          {ERRORS.map((e) => (
            <li key={e.code} className="flex gap-4 py-2">
              <span className="w-14 shrink-0 font-mono text-xs text-[var(--muted)]">{e.code}</span>
              <span className="text-[var(--muted)]">{e.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Short link behaviour</h2>
        <ul className="list-disc pl-6 text-sm text-[var(--muted)]">
          <li>
            A live link returns <code className="font-mono">302</code> with{' '}
            <code className="font-mono">Cache-Control: no-store</code>, so the redirect is never
            cached and a changed destination takes effect immediately.
          </li>
          <li>
            Unknown, disabled and expired slugs all return an indistinguishable{' '}
            <code className="font-mono">404</code>, so the set of live links cannot be probed.
          </li>
          <li>
            Only <code className="font-mono">http</code> and <code className="font-mono">https</code>{' '}
            destinations are ever returned, validated again at redirect time.
          </li>
          <li>
            Analytics are written after the redirect is sent. A failure to record a click never
            delays or fails the redirect.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Further reading</h2>
        <ul className="list-disc pl-6 text-sm text-[var(--muted)]">
          <li>
            <Link href="/privacy" className="underline underline-offset-4">Privacy</Link> — exactly what is
            and is not collected.
          </li>
          <li>
            <Link href="/terms" className="underline underline-offset-4">Terms</Link> — acceptable use, and
            the guarantees that are explicitly not offered.
          </li>
          <li>
            The repository README covers local setup, environment variables and deployment;
            <code className="font-mono"> THREAT-MODEL.md</code> and{' '}
            <code className="font-mono">BACKUP-RECOVERY.md</code> cover operational risk.
          </li>
        </ul>
      </section>
    </article>
  );
}
