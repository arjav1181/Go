# Architecture — go.

**Product:** `go.arjav.is-cool.dev`  
**Purpose:** A small, privacy-conscious link shortener that can grow into a programmable redirect engine.  
**Design principle:** Keep the first release simple and reliable; make later experiments possible without building them prematurely.

## 1. System overview

### Recommended stack

- **Application:** Next.js App Router, React, TypeScript, Tailwind CSS. Reuse the repository's existing stack if it is already configured and healthy.
- **UI:** Existing component system if present; otherwise use accessible, lightweight components. Avoid adding a large UI framework just for a few screens.
- **Authentication:** Supabase Auth with server-side session handling. Only explicitly allowlisted owner email addresses can use the management interface.
- **Database:** Supabase Postgres.
- **Hosting:** Vercel or another host compatible with the repository's Next.js setup.
- **Validation:** Zod (or an existing equivalent) for all user-controlled inputs.
- **Charts:** Use a lightweight chart library only if one is needed for the analytics screen.
- **QR codes:** Generate QR codes within the application using a maintained package; do not send link data to a third-party QR service.

Prefer free-tier-compatible services. Do not introduce a paid dependency or require a payment method without clearly documenting it. The app must still work locally without production credentials where practical.

## 2. High-level request flow

### Link creation and management

1. Owner opens `/login` and signs in through Supabase Auth.
2. Server verifies the session and that the verified email is in `OWNER_EMAILS`.
3. Owner creates or edits a link through a server action or authenticated route handler.
4. The server validates the slug and destination, then writes to Postgres.
5. The dashboard reads only the data needed to manage links and display aggregate analytics.

### Public redirect

1. Visitor opens `https://go.arjav.is-cool.dev/<slug>`.
2. `app/[slug]/route.ts` looks up the slug using a **server-only** database client.
3. If the link is missing, disabled, expired, or invalid, return a helpful 404/410 response rather than redirecting.
4. Record one aggregate click in the daily stats table, without persisting the visitor's IP address, full user-agent string, cookies, or full referrer URL.
5. Return a temporary redirect (302 by default) to the validated `http:` or `https:` destination.
6. Do not cache redirects; this allows destination edits and click counts to take effect promptly.

Analytics failures must not expose secrets or break the redirect. Handle the failure safely and log a minimal server-side error without request identifiers that could identify a visitor.

## 3. Suggested routes

Public:

- `/` — simple landing page explaining the service and offering owner sign-in.
- `/<slug>` — public short-link redirect, handled by a route handler.
- `/login` — owner sign-in.
- `/privacy` — explain what aggregate analytics is and is not collected.
- `/api/health` — minimal health check; return no secrets or detailed infrastructure information.
- `/api/export/clicks` — owner-only CSV export of aggregate click statistics (granular or daily format).
- `/api/links/<id>/qr` — owner-only QR PNG for a single link.
- `/api/v1/links`, `/api/v1/links/<id>`, `/api/v1/analytics` — owner-only JSON API.
- `/api/cron/purge` — scheduled click-history purge, gated on `CRON_SECRET`.

Owner-only:

- `/dashboard` — summary cards and link list, with search, tag filter and range controls.
- `/links/new` — create a link.
- `/links/<id>` — link details, edit controls, analytics and QR download.
- `/tags` — manage tags and folders.
- `/settings` — manage API keys and view alias-domain status.

Because aliases occupy the root path, reserve application paths such as `api`, `login`, `logout`, `dashboard`, `links`, `settings`, `privacy`, `terms`, `_next`, `favicon.ico`, `robots.txt`, `sitemap.xml`, and `health`. Reserved words cannot be custom slugs. Check the application's actual static route names too.

## 4. Database model

Use migrations checked into the repository. The following is the logical model; field names can be adapted to established repository conventions.

### `links`

- `id` — UUID primary key.
- `slug` — lowercase text, unique, constrained by the slug rules below.
- `destination_url` — validated absolute URL; only `http:` and `https:` allowed.
- `title` — optional human-readable label.
- `notes` — optional private note; never shown to redirect visitors.
- `is_active` — boolean, default true.
- `expires_at` — nullable timestamp.
- `created_at`, `updated_at` — timestamps.
- `created_by` — owner user ID where applicable.

Use a database unique constraint on `slug`; application-level availability checks alone are insufficient. Handle collisions cleanly.

### `daily_click_stats`

- `id` — UUID primary key, or an equivalent composite primary key.
- `link_id` — foreign key to `links`, indexed.
- `day` — UTC date.
- `referrer_host` — hostname only, or a safe fixed value such as `direct`/`unknown`; never the full referrer URL or query string.
- `device_category` — coarse category such as `mobile`, `desktop`, `tablet`, `bot`, or `unknown`; derive in memory and discard the raw user-agent.
- `click_count` — non-negative integer/bigint.
- `created_at`, `updated_at` — timestamps if useful.

Add a unique key across `(link_id, day, referrer_host, device_category)` and increment counts atomically using an upsert. Do not create a per-visitor event table in the initial release.

### `tags`, `folders` and join tables (P1)

Organisation is many-to-many and additive; it never affects redirect behaviour.

- `tags` — `id`, `name` (lowercase, safe charset), `created_by`, `created_at`.
  Unique per owner via `(coalesce(created_by, zero-uuid), name)` so multiple allowlisted
  owners do not collide and legacy NULL owners still enforce uniqueness.
- `folders` — `id`, `name`, `parent_id` (self-reference, `on delete set null` so deleting a
  parent never deletes children), `created_by`, `created_at`. Unique per owner.
- `link_tags` — `(link_id, tag_id)` primary key, both cascading on delete.
- `link_folders` — `(link_id, folder_id)` primary key, both cascading on delete.

Deleting a tag or folder removes only the assignment; links are never deleted. Tag/folder ids
arriving from the client are re-validated against the owner's own rows before use.

### Link ownership

`links.created_by` records the owner who created a link. Links created before this column was
used have `created_by IS NULL`; `claimUnownedLinks()` adopts those rows on first owner access
so upgrading from P0 never hides existing links. Owner-scoped reads (dashboard, export, QR)
use this column.


### Access model

- Enable Row Level Security on tables.
- Do not expose the Supabase service-role key to a browser bundle, `NEXT_PUBLIC_*` variable, client component, or API response.
- Use a server-only database client for redirect resolution and controlled writes. All owner mutations must independently verify the authenticated session and the email allowlist on the server.
- Keep public access limited to redirect resolution; never expose private notes, destination-management APIs, owner records, or raw database credentials.
- If a service-role client is used, treat it as fully privileged and keep every operation behind narrow server-side functions with validated inputs.

## 5. Slug and URL rules

### Slugs

- Normalize custom slugs to lowercase.
- Allow only a documented safe pattern such as `[a-z0-9_-]`, with a reasonable length (for example, 3–64 characters).
- Reject empty, malformed, reserved, path-like, or duplicate slugs.
- Generate unpredictable random slugs for users who do not specify one; do not expose database IDs as slugs.
- Retry a small, bounded number of times on generated-slug collisions.
- Use a database unique constraint to resolve race conditions.

### Destination URLs

- Parse using the platform URL parser and store a normalized absolute URL.
- Allow `http:` and `https:` only. Reject `javascript:`, `data:`, `file:`, protocol-relative values, malformed URLs, and control characters.
- Prevent a link from immediately redirecting back into this same short-link host to avoid trivial redirect loops. If nested links are intentionally supported later, detect and cap redirect chains.
- Never interpolate an unvalidated URL into HTML.
- Default to `302 Found`, not a permanent cached redirect, because destinations can change and clicks need to be counted.

## 6. Privacy-conscious analytics

Collect the minimum needed to answer: “How often is this link clicked, over time, and what broad source/device category did the click come from?”

- Count clicks, not unique people. Do not label clicks as unique visitors.
- Do not set analytics cookies or use browser fingerprinting.
- Do not persist IP addresses, raw user-agent strings, full referrer URLs, URL query parameters, or cross-site identifiers.
- Store only a referrer hostname and coarse device category. Normalize missing sources to `direct`/`unknown`.
- Show timezone context for date charts; use UTC for stored aggregation and convert consistently for display.
- Document the collected fields in `/privacy`.
- If analytics processing fails, the redirect should still succeed.

This is privacy-conscious design, not a guarantee of legal compliance. Review applicable requirements before opening the service to public link creation.

## 7. Security and abuse controls

- There is **no public sign-up or public link creation** in the initial release. This is a personal/owner-operated tool.
- Gate every dashboard page, server action and management API with server-side authentication plus `OWNER_EMAILS` authorization. Hiding UI elements is not authorization.
- Validate server-side even if the UI validates too.
- Never trust a client-supplied owner ID, click count, or permission value.
- Use secure session cookies through the supported auth library; do not roll a custom password/session system.
- Avoid leaking whether an arbitrary destination is on an internal network; the app is redirecting, not fetching destination URLs server-side.
- Add reasonable request/body limits to mutation routes and generic, non-sensitive error messages.
- Add security headers suitable for the app. Mark redirect responses `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow, noarchive`.
- Do not fetch URLs to create previews in v1. If link previews are added later, build explicit SSRF protections.
- Do not claim links are safe simply because they use this service. Include a way for the owner to disable a link quickly.

## 8. Performance and reliability

- Index `links.slug` (unique), and `daily_click_stats(link_id, day)`.
- Keep the redirect path short: lookup, best-effort aggregate increment, redirect.
- Use atomic database upserts for counters to prevent lost increments.
- Keep database and service-role access server-side.
- Return a useful not-found/expired page without revealing internal database errors.
- Include loading, empty, success, validation and failure states in the UI.
- Avoid unnecessary polling. Refresh analytics on navigation or explicit refresh.

## 9. Suggested project structure

Adapt to the existing repository rather than blindly replacing it.

```text
app/
  page.tsx
  login/page.tsx
  dashboard/page.tsx
  links/new/page.tsx
  links/[id]/page.tsx
  privacy/page.tsx
  [slug]/route.ts
  api/health/route.ts
  actions/links.ts
components/
  app-shell.tsx
  link-form.tsx
  links-table.tsx
  analytics-summary.tsx
  qr-download.tsx
lib/
  auth/owner.ts
  db/supabase-server.ts
  links/validation.ts
  links/slug.ts
  analytics/record-click.ts
  analytics/device-category.ts
  utils.ts
supabase/
  migrations/
  config.toml (if used)
tests/
  slug.test.ts
  destination-url.test.ts
  redirect.test.ts
.env.example
ARCHITECTURE.md
PRD.md
```

Do not force this exact layout if the existing repository uses a sound convention.

## 10. Environment variables

Provide `.env.example` with names and explanations, but no secrets. Likely variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or the current publishable-key name supported by the project)
- `SUPABASE_SERVICE_ROLE_KEY` (server only; never prefixed with `NEXT_PUBLIC_`)
- `OWNER_EMAILS` (comma-separated verified owner emails)
- `NEXT_PUBLIC_APP_URL` (for example `https://go.arjav.is-cool.dev`)

Follow the current Supabase SDK's supported key names; do not invent credentials or commit real values.

## 11. Testing requirements

At minimum, test:

- valid, invalid, reserved and duplicate slugs;
- destination scheme validation, malformed URLs and redirect-loop prevention;
- anonymous users cannot access owner pages or mutate links;
- signed-in non-allowlisted users remain unauthorized;
- active links redirect to the expected destination with 302;
- missing, disabled and expired links do not redirect;
- analytics uses atomic aggregate increments and doesn't store IP/raw UA/full referrer URLs;
- private notes and service credentials never appear in public responses.

Provide clear setup instructions for local development, database migration, authentication allowlisting, deployment, and binding `go.arjav.is-cool.dev` to the host. Do not change the existing apex/subdomain website records or Zoho Mail records as part of application setup.

## 12. Redirect engine (P2)

Destination resolution is a pure, testable chain. Precedence, highest first:

1. an active scheduled window covering `now`;
2. a weighted variant;
3. the link's own `destination_url`.

The lifecycle checks (disabled / expired / not found) run **before** this chain, so no schedule or
variant can resurrect a link that should not redirect.

- `link_schedules` — `starts_at`, `ends_at` (nullable = open-ended). Windows for a link may not
  overlap; the API rejects an overlapping window so resolution is never ambiguous.
- `link_variants` — `label`, `destination_url`, `weight` (0–100), `is_active`. Weights are relative,
  so `[1,3]` and `[25,75]` produce the same split. Selection is random per request: no cookie, no
  fingerprint, nothing persisted that identifies a visitor.
- `daily_click_stats.variant_label` — adds one more grouping dimension to the existing aggregate
  table. No new visitor data is collected.

## 13. Owner-only API (P2)

- Keys are shown once and stored only as a SHA-256 hash; comparison is constant-time.
- `key_prefix` exists only so the owner can identify a key in the UI.
- Every request re-checks the key's owner against `OWNER_EMAILS`, so removing an owner from
  configuration immediately invalidates every key they own.
- The API reuses `lib/links/service.ts` so API and dashboard enforce identical slug, destination
  and expiry rules. Bodies are size-limited and only documented fields are accepted.
- Requests are authenticated, not rate-limited. Rate limiting belongs in a dedicated provider.

## 14. Alias domains (P2, opt-in)

Disabled unless `ALIAS_DOMAINS` is set. When enabled, requests on a configured host resolve links
scoped to that host (`links.domain`); the canonical host and unknown hosts fall back to the
default scope, so a DNS mistake degrades to normal behaviour rather than breaking every link.
Clearing the variable turns the feature off again — no migration or code change.

Wildcard TLS is a paid capability on most hosts. DNS and certificate provisioning remain manual
and are never performed by this application.

## 15. Phase 3: programmable link engine

### Resolution chain

The redirect path evaluates in a fixed order, and every layer falls back to the
layer below it when it yields nothing:

1. link lifecycle (missing / disabled / expired) — authoritative, never bypassed;
2. an active scheduled window;
3. a matching conditional rule, weighted among the rules that matched;
4. an experiment variant, chosen by deterministic bucketing;
5. the link's own destination.

Every candidate destination is re-validated as an `http:`/`https:` URL before it
is returned, so corrupt or hostile stored values fall back rather than escaping.

### Deterministic bucketing

`bucket = sha256(EXPERIMENT_SALT | host | link_id)` mapped into 10,000 buckets,
then mapped onto the cumulative weight distribution. The same link always
produces the same arm, so repeat visits are not re-randomised, while **nothing
about the visitor is stored** — the hash input is the link, never a person.
Weights are relative, so `[1,3]` and `[25,75]` are equivalent.

### Conditional rules

`link_rules` + `link_rule_conditions`. Conditions are a **closed set** enforced by
a CHECK constraint: `query_param` (exact value equality against an allowlist) and
`time_window` (half-open interval). There is deliberately no expression, pattern or
script language, and no IP/geo/user-agent/cookie/referrer condition. An unknown
`kind` is treated as "no match" rather than being interpreted.

Ordering is by ascending `priority`, ties broken by name, so evaluation is
deterministic. `validateRuleSet()` rejects rules that would match everything and
flags duplicate conditions and priority ties as warnings, which the UI surfaces
instead of leaving them to be discovered in production.

Known tracking parameters are filtered before evaluation unless an owner
explicitly allowlists the exact parameter, so rules cannot become an inadvertent
campaign-tracking mechanism.

### Experiments

`link_experiments` wraps weighted `link_variants`. A partial unique index permits
only one `active` experiment per link, which keeps routing unambiguous. Lifecycle
transitions are validated server-side: a `stopped` experiment can never be
resumed, and a variant change that would leave no eligible variant is rejected
before the write.

### Statistics

`lib/experiments/stats.ts` implements a pooled two-proportion z-test. The normal
CDF is computed by Simpson integration rather than a fitted polynomial, and is
verified against the definitional percentiles (`Phi(1.959964) = 0.975`). The test
returns `insufficient` — with **no p-value** — when either arm is below the
minimum sample, when both rates are 0% or 100%, or when the pooled rate is
degenerate. Explanations never assert an improvement.

### Timezones

The UI captures a wall-clock time plus an explicit IANA zone and posts both; the
server converts to a UTC instant before storage using `Intl`, so daylight-saving
transitions are handled by the platform and the stored value is unambiguous.

## 16. Phase 4: hardening and observability

### Rate limiting

Counters live in Postgres (`rate_limit_buckets` + `rate_limit_hit()`), because
the application runs across multiple instances and an in-memory counter only
limits one. Bucket keys are **sha256 hashes** of the caller value, so a database
dump never reveals an address.

The limiter **fails open** when the store is unreachable. Losing a rate limit is
preferable to breaking a visitor's redirect or an owner's dashboard; the trade-off
is documented as a residual risk rather than hidden.

The public redirect path is limited on the *failure* path only. Charging a bucket
on every successful redirect would add a database round trip to the hot path and
could penalise a whole office behind one address.

### Redirect path cost

Configuration is loaded with one embedded PostgREST query. If that query fails —
for example on a database that has not had the Phase 3 migrations applied — the
loader falls back to per-table lookups, and missing tables degrade to empty
collections. A partial schema therefore reduces a link to its own destination
instead of failing the request.

### Logging and correlation

One JSON object per event. `lib/log.ts` enforces redaction centrally: credentials,
cookies, API keys, destination URLs, notes, referrers, user agents and caller
addresses are dropped by field name, and anything resembling a bearer token is
stripped from free text. Correlation ids identify a **request**, never a visitor,
and are not persisted.

### Experiment reproducibility

`experiment_config_versions` stores an immutable routing snapshot whenever the
configuration changes. `lib/experiments/replay.ts` reproduces any assignment
from a snapshot alone, which is what makes a reported aggregate checkable after
the experiment has been edited or stopped. The routing simulation is a property of
the bucketing function and is reported separately from observed outcomes.

## 17. Launch-time findings

Recorded because each was invisible to documentation review and only surfaced by
running the thing.

**Framework patch level is a security control.** The pinned Next.js version
carried unauthenticated RCE advisories. Version pinning in a lockfile is only
useful if something forces the bump; CI now runs `npm audit --omit=dev` at
`--audit-level=high` so a regression fails the build rather than shipping.

**Declare what you import.** `postcss.config.mjs` referenced a package absent
from `package.json`. The build succeeded locally because Node walked up into an
unrelated parent `node_modules`. A clean-room `npm ci` build is the only test
that catches this, which is why CI builds from scratch. `turbopack.root` is
pinned so module resolution cannot escape the project directory again.

**Static routes beat dynamic ones silently.** Next.js matches `app/tags/page.tsx`
before `app/[slug]/route.ts`. A link whose slug equals a route is not an error —
it is a link that is saved, listed, and never fires. Reserved slugs are therefore
derived from the filesystem in `tests/reserved-routes.test.ts` rather than
maintained by hand.

**Observability that cannot fail loudly is not observability.** The operational
event function caught `others` and returned void, so a total failure looked
identical to a quiet day, and nothing called it. It now returns a boolean, is
covered by tests, and is invoked from sign-in, rate-limit and cron paths.

**Two log paths, one redaction policy.** `lib/log.ts` denies fields by name. A
denylist is only as good as the names it anticipates, so `destination` and `note`
were added alongside `destination_url` and `notes`. Free-text values are scanned
for token-shaped substrings as a second layer.

## 18. Extension seams (not initial-release requirements)

Design modules so these could be added later without a rewrite, but do not implement them until the MVP works:

- weighted A/B redirects;
- scheduled destinations and link expiration controls;
- destination rotation and campaign rules;
- custom domains;
- API keys and a documented public API;
- retention/aggregation controls and optional rate limiting through a dedicated provider.

Keep these behind a separate future phase. Do not ship a rule engine, job queue or microservices architecture in v1.

Remaining: retention settings and configurable aggregation dimensions.
