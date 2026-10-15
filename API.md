# go. — Owner API (v1)

A small, owner-only JSON API for managing links and reading aggregate analytics.

Base URL: `https://go.arjav.is-cool.dev/api/v1`

Everything here is optional. The web UI is the primary interface; this exists for
scripting and automation.

---

## Authentication

All endpoints require an API key as a bearer token:

```
Authorization: Bearer go_xxxxxxxxxxxxxxxxxxxxxxxx
```

Create a key at **`/settings`**. The plaintext key is displayed exactly once and is
stored only as a SHA-256 hash — it cannot be recovered later.

### Scopes (least privilege)

Grant only what a caller needs. Scopes are chosen when the key is created and are
carried on rotation.

| Scope | Grants |
|---|---|
| `links:read` | List links |
| `links:write` | Create, update and delete links |
| `analytics:read` | Read aggregate analytics |

A key with no recognised scope falls back to `links:read`, so a malformed
configuration can never make a key more permissive than intended. Scopes are not
implied: `links:write` does **not** grant `links:read`.

### Authorisation

Every request additionally re-checks that the key's owner is still present in
`OWNER_EMAILS`. Removing an owner from configuration immediately invalidates every
key they own, without any extra step.

### Rotation and revocation

- **Rotate** issues a replacement with the same scopes and revokes the old key in a
  single step. The new secret is shown once.
- **Revoke** is immediate and irreversible.

### Rate limiting

API requests are limited per key. Limits are enforced in Postgres, so they hold
across multiple instances. Separate budgets exist for sign-in attempts, link
creation and editing, QR generation, CSV export and public redirect failures.

If the limiter store is unreachable, nonessential paths **fail open** so a
redirect is never blocked by limiter trouble. See `THREAT-MODEL.md`.

Every rate-limited response carries: Responses carry:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1788000000
```

Exceeding the limit returns `429` with `Retry-After`. The default can be changed
with `API_RATE_LIMIT_PER_MINUTE`.

> The limiter is per-instance and in-memory, so on a serverless host the effective
> ceiling scales with the number of running instances. It is a guard against
> accidents, not a hostile-traffic control.

### Request limits

JSON bodies are capped at **8 KiB**. Larger bodies are rejected with
`invalid_request` before any work is done. Authentication is checked before the
body is read, so unauthenticated callers cannot force body parsing.

---

## Errors

Every error uses the same envelope. `code` is stable and safe to branch on;
`message` is for humans and never contains internal detail or secrets.

```json
{ "error": { "code": "insufficient_scope", "message": "This key lacks the \"links:write\" scope." } }
```

| Code | Status | Meaning |
|---|---|---|
| `invalid_request` | 400 | Malformed JSON, or a field failed validation |
| `unauthorized` | 401 | Missing, malformed, unknown or revoked key |
| `forbidden` | 403 | Key's owner is no longer allowlisted |
| `insufficient_scope` | 403 | Key lacks the scope this endpoint needs |
| `not_found` | 404 | No such link, or it is not owned by this key |
| `rate_limited` | 429 | Too many requests |
| `server_error` | 500 | Unexpected failure |
| `rate_limit_not_configured` | 503 | Reserved for the scheduled purge endpoint |

---

## Endpoints

### `GET /links` — list links

Scope: `links:read`

Query parameters:

| Parameter | Default | Notes |
|---|---|---|
| `limit` | `100` | Clamped to 1–200 |

```bash
curl -H "Authorization: Bearer $GO_KEY" \
  https://go.arjav.is-cool.dev/api/v1/links
```

```json
{
  "links": [
    {
      "id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "slug": "example",
      "destination_url": "https://example.com/",
      "title": "Example",
      "is_active": true,
      "expires_at": null,
      "created_at": "2026-09-01T12:00:00.000Z",
      "short_url": "https://go.arjav.is-cool.dev/example"
    }
  ],
  "count": 1
}
```

Private notes are never included in list responses.

### `POST /links` — create a link

Scope: `links:write`

```bash
curl -X POST -H "Authorization: Bearer $GO_KEY" \
  -H 'content-type: application/json' \
  -d '{"destination_url":"https://example.com","slug":"example","title":"Example"}' \
  https://go.arjav.is-cool.dev/api/v1/links
```

Request fields (all optional except `destination_url`):

| Field | Type | Notes |
|---|---|---|
| `destination_url` | string | Required. Absolute `http:`/`https:` URL. |
| `slug` | string \| null | Omit or pass `null` to generate a random slug. |
| `title` | string \| null | Max 200 characters. |
| `notes` | string \| null | Max 5000 characters. Private. |
| `expires_at` | string \| null | ISO timestamp; `null` means no expiry. |

Returns `201` with `{ "link": { ..., "short_url": "..." } }`.

Validation is identical to the dashboard: slugs must be 3–64 characters of
`[a-z0-9_-]`, may not be reserved, and `javascript:`, `data:` and loop-back
destinations are rejected.

### `PATCH /links/{id}` — update a link

Scope: `links:write`

Only the fields present in the body are changed; unknown fields are ignored.

```bash
curl -X PATCH -H "Authorization: Bearer $GO_KEY" \
  -H 'content-type: application/json' \
  -d '{"is_active":false}' \
  https://go.arjav.is-cool.dev/api/v1/links/$LINK_ID
```

### `DELETE /links/{id}` — delete a link

Scope: `links:write`

Returns `204` with no body.

### `GET /experiments/{id}` — reproducible experiment evaluation

Scope: `analytics:read`

Returns everything needed to check a reported number independently:

```bash
curl -H "Authorization: Bearer $GO_KEY" \
  https://go.arjav.is-cool.dev/api/v1/experiments/$EXPERIMENT_ID
```

| Section | Contents |
|---|---|
| `experiment` | Name, status, recorded hypothesis, outcome metric, evaluation window |
| `configuration` | Archived versioned routing config (salt is never returned) |
| `results` | Per-variant assignments, clicks, target vs observed share, verdict |
| `routing_check` | Simulation of the bucketing function against target weights |
| `replay` | One deterministic routing decision for this link |
| `limitations` | Assumptions, caveats and multiple-comparison warning |

Query parameters:

| Parameter | Default | Notes |
|---|---|---|
| `version` | latest | Fetch a specific archived configuration version |

**Important distinctions.** `routing_check` is a property of the bucketing
function, not evidence about real visitors. `results.verdict` is a two-proportion
z-test that is withheld entirely unless each variant has at least 100
observations and the rates are non-degenerate. With more than two variants no
multiple-comparison correction is applied, so pairwise verdicts are optimistic.
Aggregate clicks are not unique people, so repeated clicks from one person are
not independent observations.

### `GET /analytics` — aggregate click statistics

Scope: `analytics:read`

Query parameters:

| Parameter | Default | Notes |
|---|---|---|
| `range` | `30d` | `7d`, `30d`, `90d` or `custom` |
| `start` / `end` | — | Required when `range=custom`, `YYYY-MM-DD`, UTC |

```bash
curl -H "Authorization: Bearer $GO_KEY" \
  "https://go.arjav.is-cool.dev/api/v1/analytics?range=7d"
```

```json
{
  "range": { "start": "2026-09-09", "end": "2026-09-15", "timezone": "UTC" },
  "previous_range": { "start": "2026-09-02", "end": "2026-09-08" },
  "total_clicks": 128,
  "previous_total_clicks": 96,
  "daily": [{ "day": "2026-09-09", "clicks": 0 }],
  "referrers": [{ "key": "example.com", "clicks": 40 }],
  "devices": [{ "key": "mobile", "clicks": 61 }],
  "by_link": [{ "id": "...", "slug": "example", "title": "Example", "clicks": 128 }],
  "note": "Counts are aggregate clicks, not unique visitors. No IP addresses or raw user agents are stored."
}
```

Days are UTC. The response contains only coarse aggregates; there is no
per-visitor data to return.

---

## What the API deliberately does not expose

- IP addresses, raw user agents, cookies or fingerprints — they are never stored.
- Private notes in list responses.
- Rule internals, experiment internals or variant traffic splits.
- Anything about other owners' links; every query is scoped by `created_by`.

---

## Rollback

Schema changes ship as numbered migrations in `supabase/migrations/`. To revert a
deployment, roll back the code and leave the schema in place — every Phase 3 table
is additive and unused by older code paths. Dropping columns is **not**
recommended: `links`, `link_variants` and `daily_click_stats` are shared with
earlier phases.

If you must revert schema changes, take a database snapshot first and re-run the
migrations in order to restore the expected shape.