# Product Requirements — go.

**Working name:** go.  
**Canonical host:** `go.arjav.is-cool.dev`  
**Product type:** Owner-operated link shortener with privacy-conscious aggregate analytics.  
**Status:** Initial build specification.

## 1. Product summary

Build a fast, polished personal link service. The owner can create memorable short links, edit destinations, pause or expire links, download QR codes and view aggregate click analytics. Anyone can open an active short link and be redirected.

The first release must be useful and dependable, not a generic multi-tenant SaaS. Keep the architecture ready for future experiments such as scheduled redirects and A/B routing, without implementing a complex rules engine in v1.

## 2. Problem and opportunity

Long URLs are awkward to share and hard to remember. Existing link-management services may add branding, analytics or account features the owner does not need. This project gives the owner a branded short domain, control over destinations and a transparent, privacy-conscious analytics model. It is also a long-running technical experiment that can evolve in public.

## 3. Goals

1. Create short links on `go.arjav.is-cool.dev`.
2. Make public redirects fast and reliable.
3. Provide a clean owner-only interface for managing links.
4. Show useful aggregate analytics without cookies or visitor fingerprinting.
5. Generate QR codes locally/in-app for short links.
6. Start with free-tier-compatible infrastructure and straightforward deployment.
7. Make later programmable redirect features possible without overengineering v1.

## 4. Non-goals for v1

- Public sign-up, teams, billing or a commercial multi-tenant SaaS.
- A general-purpose analytics platform or unique-person tracking.
- Tracking users across websites, fingerprinting, or storing IP addresses.
- Fetching destination pages to generate previews.
- A complex rule engine, A/B testing, destination rotation or geo-targeting.
- Guaranteeing that every destination is safe, or disguising malicious destinations.
- Replacing the existing website at `arjav.is-cool.dev` or changing Zoho Mail DNS records.

## 5. Users and access

### Owner

The domain owner manages links and sees analytics. The owner signs in through Supabase Auth. Only verified email addresses listed in the server-side `OWNER_EMAILS` configuration can access the management interface.

### Visitor

A visitor opens a short URL. They do not need an account, and they receive a temporary redirect only if the link is active, unexpired and valid.

There is no public link submission in v1.

## 6. Main user journeys

### Create a link

1. Owner signs in.
2. Owner selects “New link”.
3. Owner enters a destination URL and optionally a custom slug, title, note and expiry date.
4. UI provides clear validation and previews the resulting short URL.
5. Server validates everything again and saves the link.
6. Owner copies the short URL or downloads a QR code.

If the slug is omitted, generate a short random slug. If it is unavailable, explain the conflict without losing the form fields.

### Use a short link

1. Visitor opens `https://go.arjav.is-cool.dev/<slug>`.
2. Active, unexpired links redirect with HTTP 302.
3. Missing, disabled or expired links show a clear, branded error page and do not expose internal errors.
4. The click is counted in aggregate analytics when possible; analytics trouble must not break the redirect.

### Inspect analytics

Owner opens the dashboard or a link detail page to see total clicks and a time series, plus broad referrer-host and device-category breakdowns. Label all figures as clicks, not unique visitors. Make empty states helpful and avoid implying statistical certainty from small samples.

### Edit or disable a link

Owner can change the destination, title, note, or expiration, and can pause/reactivate a link. The new destination should take effect promptly. A disabled link must stop redirecting immediately after the data change is visible.

## 7. Functional requirements

### P0 — Required for first working release

**Authentication and authorization**
- Supabase Auth sign-in flow suitable for an owner-only application.
- Owner allowlist checked server-side on every protected page/action/route.
- No public sign-up flow.
- Unauthenticated visitors are redirected to sign-in for management pages; unauthorized users receive an appropriate denial.

**Link management**
- List/search links by slug or title.
- Create a link with destination URL and optional custom slug.
- Edit destination, title, private note and optional expiration.
- Enable/disable a link; archive/delete only after a clear confirmation.
- Show created date, current state, short URL and click total.
- Validate destinations as absolute HTTP/HTTPS URLs only.
- Enforce slug format, reserved names and uniqueness in both application logic and database.

**Redirects**
- Resolve aliases at `/<slug>` on the configured short-link host.
- Redirect active, unexpired links with 302 and `Cache-Control: no-store`.
- Do not redirect for unknown, disabled or expired links.
- Provide a branded not-found/expired page.
- Avoid root route collisions by reserving application route names.

**Analytics**
- Count clicks by UTC day.
- Show total clicks and a time-series chart for a selected range.
- Show referrer hostname and coarse device category, where available.
- Use atomic aggregate upserts so concurrent clicks are not lost.
- Do not collect IP addresses, raw user agents, analytics cookies, fingerprints, full referrer URLs or query strings.
- Do not claim to show unique visitors.

**QR codes**
- Generate a QR code that encodes the short URL.
- Let the owner download it without sending the URL to a third-party QR service.

**Quality**
- Responsive and accessible interface with loading, empty, success and error states.
- Clear labels, keyboard navigation, visible focus and form error messages.
- Useful README and `.env.example`.
- Database migrations and automated tests included in the repository.

### P1 — Useful enhancements after P0 is stable

**Status: implemented.**

- Expiring links with clear remaining-time/status indicators.
  - Links report `active`, `expiring_soon` (within 7 days), `expired` and `disabled`, with a
    coarse remaining-time indicator. Status is derived in UTC from absolute instants.
  - Server-side redirect enforcement remains authoritative; the UI never decides whether a
    link may redirect. A regression test asserts the two can never disagree.
- Tags or folders for organizing links.
  - Both are implemented: **tags** are flat, cross-cutting labels (many per link); **folders**
    are a single grouping that may nest one level via `parent_id`.
  - Labels can be created inline while saving a link, or managed on `/tags`.
  - Deleting a tag or folder only removes assignments; links are never deleted.
- CSV export of aggregate statistics.
  - Available in two formats: **granular** (day, link, referrer host, device category) and
    **daily** (day, link, total clicks).
  - Owner-only, RFC 4180 escaping, spreadsheet formula-injection neutralised, and the range is
    stated in the filename and response headers.
- Date-range filters and comparison with the previous period.
  - Presets for 7/30/90 days plus a custom range, compared against the immediately preceding
    window of equal length. A zero baseline is reported as "new activity" rather than a
    misleading percentage.
- A one-click copy action with feedback and QR preview.
  - Copy buttons announce success/failure to assistive technology; the QR preview renders the
    same owner-gated PNG that the download returns.
- Keyboard-friendly shortcut for creating a link.
  - Unmodified `n` opens the new-link form. It is suppressed while typing in any field, inside
    editable regions, and when modifier keys are held. The shortcut is shown next to the button
    it duplicates.

### P2 — Longer-term experiments

**Status: implemented.** Weighted A/B + rotation, scheduled destinations, the owner-only
API, alias-domain routing, and retention/aggregation controls.

- **Scheduled destinations** — non-overlapping time windows override a link's destination.
  Enforced at redirect time, so no cron job is needed for correctness.
- **Weighted A/B redirects and destination rotation** — relative weights; selection is a
  stable hash of the link rather than per-request randomness, so a visitor tends to keep the
  same variant. Nothing about the visitor is stored.
- **Retention and configurable aggregation** — retention is **off by default** and prunes
  click history on a schedule; referrer and device collection can be switched off.
- **Owner-only API** — `/api/v1`, hashed scoped keys, rotation, rate limits.
- **Alias domains** — opt-in via `ALIAS_DOMAINS`; DNS and TLS remain the operator's job.

### Phase 3 — Programmable link engine

**Status: implemented.** Builds on P2 rather than replacing it.

- **Experiments** — an experiment wraps weighted variants and has an explicit lifecycle
  (`active` / `paused` / `stopped`). Stopping is final and cannot be silently reversed.
  The previous configuration is preserved and restored whenever an experiment is paused or
  stopped, or when a rule fails.
- **Honest comparison view** — shows target vs observed traffic share and a real
  two-proportion z-test. A verdict is reported **only** when the assumptions hold (at least
  100 observations per arm, non-degenerate rates); otherwise it states why no verdict is
  possible. Nothing is ever described as an improvement or a conversion gain, because a
  click-count difference is not evidence of causation.
- **Conditional redirects** — ordered rules over query-parameter equality and time windows,
  with a default destination when nothing matches. Ordering is deterministic (lowest priority
  first, ties broken by name); ambiguous configurations are rejected or flagged rather than
  resolved silently.
- **Rule preview** — a "test request" box that runs the *same* evaluator as production and
  explains, condition by condition, why a request matched or did not.
- **No code execution** — rule values are compared with exact string equality. There is no
  regex, pattern language, or expression evaluator.
- **Explicitly unsupported** — IP, geo, device or user-agent conditions, cookies and
  referrer matching. Known tracking parameters (`utm_*`, `gclid`, `fbclid`, …) are ignored
  unless explicitly allowlisted, so rules cannot quietly become a campaign-tracking backdoor.
- **Timezone-correct scheduling** — the UI captures a wall-clock time and an explicit zone;
  the server converts to a UTC instant before storage. DST is handled by the platform.
- **API hardening** — least-privilege scopes, key rotation, per-key rate limits, 8 KiB body
  caps, and a single consistent error envelope. See `API.md`.

### Phase 5 — Launch

**Status: implemented; deployment blocked on provider access.**

Verification found and fixed defects that documentation review had missed:

- **Critical dependency vulnerability.** The pinned Next.js release carried
  multiple *unauthenticated remote code execution* advisories, plus SSRF, cache
  poisoning, DoS and middleware bypasses. The environment's package firewall
  refused to install it at all. Upgraded to the patched release; production
  dependencies now audit clean and CI enforces it.
- **A fresh clone could not build.** `@tailwindcss/postcss` was used by the
  PostCSS config but never declared in `package.json`; the build only worked
  because an unrelated parent directory supplied it.
- **Route/slug collision.** `tags` was claimable as a short link while
  `/tags` is an application route. Such a link would be saved, shown as healthy,
  and permanently shadowed.
- **Observability that reported nothing.** `record_operational_event()` had no
  callers and swallowed every error, so a broken event store looked identical to
  a quiet one.
- **Site-wide `noindex`, and `robots.txt` disallowing everything.** The public
  landing page, privacy and terms pages could never be indexed.

Also delivered: a production landing page, `/terms` and `/docs`, per-route
indexing metadata, sitemap, GitHub Actions CI, and honest documentation of the
remaining gaps.

### Phase 4 — Production hardening and experimentation

**Status: implemented.**

- **Security and abuse** — rate limits for sign-in, link creation/editing, API
  requests, QR generation, CSV export and redirect *failures*, stored in Postgres so
  they hold across instances. Sign-in moved behind a server route so limits are
  actually enforced. URL validation covers obfuscated schemes, embedded
  credentials and IDN normalisation. CSP, HSTS, COOP/CORP and a hardened
  Referrer-Policy are set. Every protected operation was re-audited.
- **Reliability** — redirect path reduced from up to six database round trips to
  two plus one analytics write, via a single embedded query with a per-table
  fallback so a partially migrated database degrades instead of breaking.
- **Observability** — structured JSON logging with enforced redaction of secrets,
  cookies, API keys, query parameters and user agents; per-request correlation ids
  that are never persisted; `/api/health` and `/api/ready`.
- **Reproducible experiments** — recorded hypotheses, evaluation windows,
  versioned configuration snapshots, a deterministic replay endpoint and a
  routing-distribution simulation that is explicitly *not* presented as a
  conversion result.
- **Documented honestly** — `THREAT-MODEL.md` states residual risks;
  `BACKUP-RECOVERY.md` marks backup and restoration as **unverified**.

## 8. UX and visual direction

Build a small, high-quality interface rather than a giant admin template. Use a clean, developer-focused visual language: strong typography, generous spacing, crisp contrast, restrained accent colour, subtle transitions and clear information hierarchy. The dashboard should feel quick and considered.

Core screens:

- `/` — compact product introduction and sign-in call to action.
- `/login` — owner sign-in.
- `/dashboard` — click overview, link list and create action.
- `/links/new` — link creation form with live short-URL preview.
- `/links/<id>` — link details, QR download, status controls and analytics.
- `/privacy` — plain-language analytics/privacy explanation.
- `/<slug>` — redirect endpoint, or branded error page for missing/disabled/expired aliases.

Avoid clutter, fake metrics, decorative charts with invented data, and animations that slow down common tasks.

## 9. Privacy and safety requirements

- No public link creation in v1.
- Do not store IP addresses or raw user-agent strings.
- Parse referrer only to a hostname; never store the full referring URL or query parameters.
- Derive broad device category in memory, then discard the raw user-agent.
- No cookies or fingerprinting for analytics.
- Validate destination URL schemes and reject malformed or unsafe schemes.
- Do not fetch URLs from the server to create previews.
- Keep all service-role credentials server-only.
- Mark redirect responses as non-cacheable and noindex/nofollow.
- Provide a fast owner control to disable a link.
- Include a privacy page that accurately describes the implemented behaviour.

## 10. Acceptance criteria

The release is ready when all of the following are true:

1. Owner can sign in, and a non-allowlisted user cannot access management functions even by calling their endpoints directly.
2. Owner can create a link using both a custom slug and a generated slug.
3. Invalid schemes (including `javascript:` and `data:`), malformed URLs, reserved slugs and duplicate slugs are rejected.
4. A valid link returns a 302 to its configured HTTP/HTTPS destination.
5. Missing, disabled and expired links do not redirect.
6. Editing the destination changes the next redirect without requiring a new short link.
7. Click counts increment atomically and appear in the dashboard.
8. Analytics storage does not include IP addresses, raw user agents or full referrer URLs.
9. Owner can download a functioning QR code for a short link.
10. Mobile and desktop layouts are usable, with accessible form and error states.
11. The repository includes migration files, tests, `.env.example`, and instructions for local setup and deployment.
12. Production setup can bind `go.arjav.is-cool.dev` without editing existing website or Zoho Mail records for `arjav.is-cool.dev`.

## 11. Success measures

For this personal experimental project, success is defined by working behaviour rather than growth metrics:

- A link can be created and shared in under a minute.
- Redirects are dependable and destination edits take effect promptly.
- Analytics are understandable and honest about what is measured.
- The app can be deployed on a free-tier-compatible setup without committed secrets.
- The codebase is simple enough to extend with future redirect experiments.

## 12. Constraints and assumptions

- Canonical short-link host is `go.arjav.is-cool.dev`, a new subdomain separate from the existing site at `arjav.is-cool.dev`.
- The DNS provider is Open Domains. DNS changes are performed manually in its dashboard; application code must not attempt to change DNS automatically.
- Hosting is expected to be Vercel or a compatible Next.js host; the deployment guide must state the exact DNS target supplied by the chosen host, not guess it.
- Supabase credentials and owner email(s) will be supplied by the owner through environment variables. Never create fake credentials.
- Preserve the existing main website and all Zoho Mail MX/TXT/CNAME records.
- Free-tier limits and product plans can change; document required services and any constraints instead of promising permanent free availability.
