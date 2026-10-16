# Threat model — go.

**Status: an honest account of what protects this service and what does not.**
This document is not a claim that the application is secure. It describes the
threats considered, the controls in place, and the known gaps.

## What this service is

A single-tenant, owner-operated URL shortener. One domain holder publishes their
own short links; visitors only ever follow a redirect. There is no public sign-up
and no public link creation.

That shape removes most of the abuse surface that makes link shorteners
attractive to spammers — but it does not remove it entirely.

## Trust boundaries

| Boundary | Trust | Notes |
|---|---|---|
| Visitor → `/[slug]` | Untrusted | Only input is the path slug and request headers |
| Visitor → `/api/health` | Untrusted | Returns a constant |
| Signed-in owner → dashboard | Partially trusted | Allowlisted email, but a compromised session is in scope |
| API key holder → `/api/v1/*` | Partially trusted | Scoped, rate limited, revocable |
| Application → Supabase Postgres | Trusted internal | Service role is fully privileged |
| Application → visitor's browser | Untrusted output | Redirects and error pages |

## Threats addressed

### Redirect abuse and open redirects
- Destinations are parsed with the platform URL parser and re-validated at
  redirect time. Only `http:` and `https:` are ever returned.
- `javascript:`, `data:`, `vbscript:`, `file:` and protocol-relative values are
  rejected, including obfuscated forms such as `java\nscript:`.
- Embedded credentials (`https://user:pass@host`) are rejected.
- A destination pointing back at the short-link host is rejected to prevent
  trivial redirect loops.
- Internationalised domains are normalised to punycode by the parser, so
  homograph-shaped hostnames are at least canonicalised rather than stored raw.
- **Residual risk:** the service redirects to whatever the owner configures. It
  does not and cannot vet destination content. A link to a harmful page is
  reachable through this domain. The `/privacy` page and the fast disable control
  exist to mitigate this, not to eliminate it.

### Enumeration and scraping
- Unknown slugs return a generic 404 that is indistinguishable in shape from a
  disabled or expired link.
- The failure path is rate limited. Successful redirects are deliberately **not**
  rate limited, to avoid adding a database round trip to the hot path and to
  avoid penalising shared addresses.
- **Residual risk:** slug space is small enough that a determined attacker can
  enumerate it offline against their own database of observed slugs.

### Credential attacks
- Sign-in is performed server-side so attempts can be limited. A limit enforced in
  the browser is not a control.
- Two independent budgets are charged per attempt: per caller and per account.
  The account budget is keyed on a **hash**, so no address is stored.
- Responses never distinguish "unknown account" from "wrong password".
- **Residual risk:** Supabase Auth is the only barrier; password strength and
  MFA are the owner's responsibility and are not enforced by this application.

### Privilege escalation and cross-owner access
- Every management page, server action and API route re-checks the session and
  the `OWNER_EMAILS` allowlist server-side.
- API keys are re-checked against the allowlist on **every** request, so
  removing an owner from configuration instantly invalidates their keys.
- Link, tag, folder, rule, experiment and QR queries are scoped by owner id.
- API keys are scoped (`links:read`, `links:write`, `analytics:read`) and scopes
  are not implied.
- **Residual risk:** the service-role key bypasses row level security by design.
  Every operation using it is a place where a future mistake could leak another
  owner's data. This is a single-tenant app, so cross-owner exposure is currently
  theoretical, but it is the highest-consequence class of bug here.

### Injection
- All database access goes through the Supabase client with parameterised
  queries. No SQL is built by string concatenation.
- The one place a filter string is composed (dashboard search) is sanitised
  first: commas, parentheses, quotes, backslashes, wildcards and control
  characters are stripped, and the result is tested.
- **Residual risk:** PostgREST filter syntax is not a formalised query language.
  The sanitiser is allowlist-based and covered by tests, but a novel bypass would
  require an authenticated owner session, so the impact is limited to that
  owner's own data.

### Cross-site scripting
- The only HTML generated for visitors is a fixed error page whose interpolated
  values are compile-time constants. No request-derived value reaches it.
- A Content-Security-Policy is set with no third-party origins.
- **Residual risk:** the CSP allows `'unsafe-inline'` for scripts, which
  Next.js requires for its inline bootstrap. This weakens CSP against an injected
  inline script. Moving to nonce-based CSP would close it and is not implemented.

### Information leakage
- Error responses use a fixed envelope and never include driver messages, stack
  traces, hostnames or versions.
- The service-role key is referenced in exactly one server-only module and is
  never prefixed with `NEXT_PUBLIC_`.
- Readiness reports booleans and latency only.
- **Residual risk:** the service-role key is long-lived. It has no automatic
  rotation, and rotation requires a Supabase dashboard action and a redeploy.

## Privacy posture (intentional, and a deliberate constraint)

The service stores no IP addresses, no raw User-Agent strings, no cookies, no
fingerprinting and no per-visitor rows.

This has real security consequences that are accepted:
- **Abuse attribution is impossible.** If a link is abused, there is no way to
  identify who did it. Mitigation is a fast disable control and rate limits.
- **Rate limiting keys on a hash of the connecting address**, which is
  approximate behind proxies and shared NAT. It is a brake, not an identity.
- **A/B bucketing hashes the link, not the visitor**, so no visitor state exists
  to abuse or subpoena.

## Verified during launch review

These were checked by running them, not by reading them:

- **Framework.** The pinned Next.js version was critically vulnerable —
  multiple *unauthenticated remote code execution* advisories, plus SSRF, cache
  poisoning, DoS and middleware bypasses — and the deployment environment's own
  package firewall refused to install it. Upgraded to the patched release.
  `npm audit --omit=dev` now reports **0 vulnerabilities** for production
  dependencies, and CI fails the build on a high-severity advisory.
- **Route/slug collisions.** `app/tags/page.tsx` existed but `tags` was not a
  reserved slug. A link created with that slug would be accepted, saved, and then
  permanently shadowed by the static route: it would appear to work and never
  redirect. Fixed, and `tests/reserved-routes.test.ts` now derives the route list
  from `app/` so a new page cannot be added without reserving its slug.
- **Silent observability failure.** `record_operational_event()` caught every
  error with `when others then null`, so a completely broken event store was
  indistinguishable from one with nothing to report. It now returns a boolean,
  and it had **no callers at all** — the table was empty in practice. Low-volume
  security events are now actually recorded.
- **Log redaction gaps.** `destination` was not redacted although the more
  obvious `destination_url` was. Both now are, along with the other plausible
  aliases.
- **Rate limiter correctness.** `rate_limit_hit()` was exercised under 300-way
  concurrency: 2400 calls produced exactly 2400 counted hits with no lost
  updates. Fixed-window rollover behaves correctly.
- **Schema.** All ten migrations apply cleanly in order against a real Postgres.
  Every table has row level security enabled with **no policies**, which is
  deny-by-default; only the service role reads data, and the anon key is used
  exclusively for sign-in.
- **Fresh-clone installability.** `postcss.config.mjs` referenced
  `@tailwindcss/postcss`, which was never declared in `package.json`. The build
  only worked because an unrelated parent directory happened to provide it. A
  clean `npm ci` build now succeeds.

## Threats considered after the product surfaces landed

Link-in-bio pages introduced the first unauthenticated read path, so:

- **What a bio page can leak** — only slug, title, destination and click count.
  Notes, campaign labels, whether a link is password-protected, owner ids and
  expiry are never projected. Password state in particular is never revealed, so
  a bio page cannot be used to discover which links are protected.
- **A bio page cannot resurrect a dead link** — a link is listed only if it is
  active and unexpired, so the page cannot contain a row a visitor cannot follow.
- **The bio handle cannot shadow a route** — reserved handles are rejected, and
  `@` is not in the slug charset, so `/@x` can never collide with `/[slug]`.
- **Owner-supplied text on a public page** — the accent colour is only honoured
  when it is a literal hex triple, and the destination href is restricted to
  http/https. The branded 404 escapes all three of its fields.

### Residual risks from the product work

1. **A password-protected link is still brute-forceable offline** if the
   database is exfiltrated. The policy requires two character classes and six
   characters, which defeats casual guessing, not a determined attacker.
2. **`show_on_bio` is an owner action, not a safety control.** An owner can
   publish a link to anything. The feature is an explicit choice by the same
   person who already controls the destination.
3. **Bulk import is an amplification surface.** It is capped at 2000 rows and
   owner-only, but an owner (or a compromised owner session) can create many
   links at once.

## Known gaps

1. **One dev-only advisory, no upstream fix.** `braces` (via
   `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` →
   `micromatch`) is flagged for stack exhaustion from deeply nested glob
   patterns. Every published 3.x version is affected, so npm's only suggestion
   is downgrading `eslint-config-next` to 14.x, which would break the lint
   configuration. It is reachable only from the lint step with
   repository-controlled patterns, and is not shipped. **Accepted.**
2. **No automated alerting.** Logs are emitted and security events are
   persisted, but nothing watches them. Alerting requires a log-drain
   integration with provider credentials that have not been supplied.
3. **Rate limiting degrades open** when the store is unreachable. This favours
   availability for owners over strict enforcement; it is a deliberate trade-off.
4. **No CSP nonce.** `'unsafe-inline'` remains for scripts.
5. **Sweep functions are not scheduled.** `sweep_rate_limit_buckets()` and
   `sweep_operational_events()` exist and work, but nothing calls them on a
   schedule, so both tables grow without bound.
6. **No multi-factor authentication** is enforced for owner accounts.
7. **Backup and restoration have not been verified** against a real project. See
   `BACKUP-RECOVERY.md`; the procedure is documented, not proven.
8. **`robots.txt` is a hint, not a control.** Private routes are server-gated;
   the robots file only stops crawlers wasting requests.

## Out of scope

- Content safety of destination pages. This service redirects; it does not fetch
  or moderate third-party content.
- DDoS absorption. That belongs to the edge/CDN provider.
- Legal or regulatory compliance assessment. Privacy-conscious design is not a
  compliance guarantee.