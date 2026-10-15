# go. — owner-operated link shortener

Short links on `go.arjav.is-cool.dev` with privacy-conscious aggregate analytics.

MIT licensed. See [`LICENSE`](./LICENSE).

## Stack
Next.js 16 (App Router), TypeScript, Tailwind CSS, Supabase Auth/Postgres.

## Features

- **Short links** on a branded domain, with custom or generated slugs.
- **Link lifecycle**: pause, expire, and clear `active` / `expiring soon` / `expired` /
  `disabled` states with remaining-time indicators. Server-side expiry enforcement is
  authoritative.
- **Organisation**: flat tags (many per link) and folders (nestable) for grouping links.
  Manage them at `/tags` or create them inline while saving a link.
- **Aggregate analytics**: daily click counts, referrer host and coarse device category.
  Range presets (7/30/90 days, custom) with previous-period comparison.
- **CSV export** of aggregate statistics (granular or per-day), generated on demand.
- **QR codes** generated in-app (never via a third-party service) with preview and download.
- **One-click copy** and a keyboard shortcut (`n`) to create a link.
- **Redirect engine**: schedule temporary destinations for a time window, and split traffic
  across weighted variants (equal weights rotate, 25/75 runs an A/B test). Selection is a
  **deterministic hash of the link**, so it is reproducible from configuration alone while
  storing nothing about the visitor — no cookies, no fingerprint, no per-visitor row.
- **Conditional redirects**: ordered rules on query-parameter values and time
  windows, with a preview that explains exactly why a request matched.
- **Experiments**: weighted A/B and rotation with pause/resume/stop and an
  honest comparison view.
- **Retention**: opt-in click-history pruning plus configurable aggregation.
- **Owner-only API** at `/api/v1` with hashed, scoped, rotatable keys — see
  [`API.md`](./API.md).
- **Alias domains** (opt-in via `ALIAS_DOMAINS`) — see the caveat below.

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment template:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OWNER_EMAILS` (comma-separated, lowercase recommended)
   - `NEXT_PUBLIC_APP_URL` (for local dev, `http://localhost:3000`)

4. Apply database migrations, in order, in your Supabase project (SQL editor or Supabase CLI):
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_tags_folders.sql`
   - `supabase/migrations/0003_redirect_engine.sql`
   - `supabase/migrations/0004_api_keys_and_alias_domains.sql`
   - `supabase/migrations/0005_retention.sql`
   - `supabase/migrations/0006_experiments.sql`
   - `supabase/migrations/0007_conditional_rules.sql`
   - `supabase/migrations/0008_rate_limits_and_observability.sql`
   - `supabase/migrations/0009_experiment_reproducibility.sql`
   - `supabase/migrations/0010_operational_event_fixes.sql`

   Or, with a direct Postgres connection string:
   ```bash
   for f in supabase/migrations/*.sql; do psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"; done
   ```
   Run them **in order**; each file assumes the previous one applied cleanly.

5. Create the owner account in Supabase Auth (email + password). Confirm the email address and
   add it to `OWNER_EMAILS`.

6. Start dev server:

   ```bash
   npm run dev
   ```

> Upgrading from an earlier P0 deployment? Links created before owner tracking existed have no
> `created_by`; the app adopts them automatically the first time an owner opens the dashboard.

## Checks

```bash
npm ci          # install exactly the committed lockfile
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

All of these run in CI on every pull request and every push to `main` — see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml). CI also builds from a
clean `npm ci`, which is what proves a fresh clone actually works, and fails on
high-severity advisories in production dependencies.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/api/ready` returns `503` | Supabase variables missing, or migrations not applied. The body names which configuration keys are absent. |
| Every short link returns "Temporarily unavailable" | Same cause. The redirect path fails safe rather than pretending a link exists. |
| Sign-in returns `503` | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` unset. |
| Sign-in returns `401` for correct credentials | Email not confirmed in Supabase Auth, or not listed in `OWNER_EMAILS`. |
| `npm run build` fails on `@tailwindcss/postcss` | Using `npm install` against a parent directory's `node_modules`. Run `npm ci` in this directory. |
| "That slug is reserved" | The slug collides with an application route. See `RESERVED_SLUGS` in `lib/links/validation.ts`. |
| Purge never runs | `CRON_SECRET` unset. The endpoint refuses to run rather than deleting data unauthenticated. |
| API returns `429` unexpectedly | Rate limit too low, or a shared address is consuming the per-caller budget. Tune `RATE_LIMIT_*`. |
| Analytics counts look low | Click recording is best-effort and happens *after* the redirect is sent. A failure is logged, not retried. |

## Deploying and binding `go.arjav.is-cool.dev`

1. Deploy the app to Vercel (or a compatible Next.js host).
2. In the host dashboard, add the custom domain `go.arjav.is-cool.dev`.
3. Use the exact DNS target value supplied by the host for that domain.
4. In the Open Domains dashboard, create **only** the DNS record(s) required for the new `go`
   subdomain. Do not modify existing apex `arjav.is-cool.dev` records or Zoho Mail MX/TXT/CNAME
   records.
5. Add the same environment variables from `.env.example` in the host project settings,
   including `OWNER_EMAILS` and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
6. Keep `NEXT_PUBLIC_APP_URL` set to `https://go.arjav.is-cool.dev`.

## API

Full reference in [`API.md`](./API.md). Create a key at `/settings` (shown once,
stored only as a hash, scoped and rotatable), then:

```bash
curl -H "Authorization: Bearer go_..." https://go.arjav.is-cool.dev/api/v1/links
curl -X POST -H "Authorization: Bearer go_..." -H 'content-type: application/json' \
  -d '{"destination_url":"https://example.com","slug":"example"}' \
  https://go.arjav.is-cool.dev/api/v1/links
```

Supported: `GET /api/v1/links`, `POST /api/v1/links`, `PATCH /api/v1/links/<id>`,
`DELETE /api/v1/links/<id>`, `GET /api/v1/analytics`. Each requires the matching
scope (`links:read`, `links:write`, `analytics:read`).

## Alias domains (optional)

Set `ALIAS_DOMAINS=alias.example.com,other.example.com` to let those hosts serve short links.
Leave it unset (the default) to keep the feature off, and clear it to disable it again — no code
change or migration. Links already created stay on the canonical host.

> **Cost caveat:** serving arbitrary extra domains requires wildcard TLS, which is a paid feature on
> most hosts (e.g. Vercel Pro). This project does not include it and never changes DNS — you must
> point each host at your host and provision a certificate yourself.

## Traffic splitting

A/B variants are chosen by hashing `EXPERIMENT_SALT + host + link id`. A visitor
usually keeps the same variant between visits, but **nothing is stored about them**
— no cookie, no fingerprint, no per-visitor row. Traffic split is approximate.
Changing `EXPERIMENT_SALT` re-buckets everyone.

## Scheduled retention

Click-history retention is **off by default**. When enabled, a daily Vercel Cron
hits `/api/cron/purge`, which requires `CRON_SECRET` and refuses to run if that
variable is unset. Nothing runs without it.

## Operations

| Endpoint | Purpose |
|---|---|
| `/api/health` | Liveness. Constant response, touches nothing, safe to expose. |
| `/api/ready` | Readiness. Reports database reachability and configuration booleans. Returns `503` when not ready. |
| `/api/cron/purge` | Scheduled click-history purge. Requires `CRON_SECRET`; **refuses to run** when unset. |

Logs are structured JSON with secrets, cookies, API keys, destinations, query
parameters and raw user agents redacted.

A small set of **low-volume, security-relevant** events — failed sign-ins,
rate-limited sign-ins, denied API calls, cron runs and purge results — is also
persisted to the `operational_events` table so they can be counted and alerted on.
stdout is not queryable, and "how many failed logins last night?" is not a
question a log search answers reliably. The redirect hot path is deliberately
**not** persisted: a database write per redirect would make the cheapest operation
the most expensive one.

```sql
-- Recent failed sign-ins
select created_at, context from public.operational_events
where event = 'auth.login_failed' and created_at > now() - interval '24 hours'
order by created_at desc;
```

Rate-limit buckets and operational events both have sweep functions
(`sweep_rate_limit_buckets`, `sweep_operational_events`). **Neither is scheduled
automatically** — see the launch report.

See [`THREAT-MODEL.md`](./THREAT-MODEL.md) for what is and is not protected, and
[`BACKUP-RECOVERY.md`](./BACKUP-RECOVERY.md) for backup and restoration
procedures (**restoration has not been verified against a real project**).

Rate limits are stored in Postgres so they hold across multiple instances. If the
store is unreachable the limiter **fails open** for nonessential paths to keep
redirects working.

## Experiment evaluation

`GET /api/v1/experiments/{id}` returns the archived, versioned configuration, the
aggregate results with sample sizes, a deterministic replay of one routing
decision, and a simulated routing-distribution check.

The simulation verifies the **bucketing function** against the configured weights.
It is not a measurement of real visitors and says nothing about conversion. The
only outcome metric currently recorded is aggregate clicks; if no reliable
conversion event exists it is **not** invented.

## Known gaps

Recorded honestly rather than left to be discovered:

- Backups and a restore drill are **unverified** — see `BACKUP-RECOVERY.md`.
- No alerting pipeline is configured. Logs are emitted; nothing watches them.
- `sweep_rate_limit_buckets` and `sweep_operational_events` exist but are not
  scheduled, so both tables grow without bound.
- CSP still permits `'unsafe-inline'` for scripts, which Next.js requires.
- The service-role key has no automated rotation.
- One dev-only advisory (`braces`, via the ESLint toolchain) has no upstream fix
  and does not ship. Production dependencies audit clean.

## Privacy

See `/privacy` in the app. Aggregate clicks only: daily counts, referrer hostname, coarse
device category. No IP addresses, raw user agents, cookies, fingerprints, or full referrer URLs
are stored. CSV exports carry the same guarantee and exclude private notes.