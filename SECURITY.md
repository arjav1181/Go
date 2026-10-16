# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Email the maintainer directly, or use GitHub's private reporting on this
repository if it is enabled. Please include:

- what an attacker can do, and what they need in order to do it
- the affected route, file or endpoint
- a reproduction if you have one

You should get an acknowledgement within a few days. Fixes for confirmed
issues are prioritised by severity, not by how easy they are to explain.

There is no bug bounty. This is a small privately operated project.

## Threat model

`THREAT-MODEL.md` documents what is protected and what is not. Read it before
reporting something — several behaviours look like vulnerabilities and are
deliberate, including:

- **No IP addresses are stored.** Rate limiting hashes the connecting address,
  so abuse cannot be attributed to an individual. This is intentional and is
  the central privacy trade-off, not an oversight.
- **Redirects are not rate limited**, only failed lookups are. Charging a
  bucket on every successful redirect would add a database round trip to the
  hot path and would penalise whole offices sharing one address.
- **Row level security has no policies**, so the anon key reads zero rows.
  All access goes through the service role. This is deny-by-default.

## Scope

In scope:

- Authentication bypass on any dashboard, action or API route
- Cross-owner data access
- Redirects to a destination the owner did not configure
- Ability to read a protected link's destination without the password
- Injection into a public bio page
- Ability to claim a slug that shadows an application route

Out of scope:

- Content of destination pages. This service redirects; it does not fetch or
  moderate third-party content.
- Denial of service against the hosting provider.
- Absence of a published CVE-worthy advisory in a dependency that is not
  reachable from user input.

## Self-hosting

If you run your own instance, you own its security. In particular:

- `SUPABASE_SERVICE_ROLE_KEY` bypasses row level security entirely. Anyone who
  reads it has your entire database.
- `CRON_SECRET` gates the retention purge. If it is unset the endpoint refuses
  to run rather than deleting data unauthenticated — do not "fix" that by
  removing the check.
- Keep `OWNER_EMAILS` set. With it empty, nobody can sign in.