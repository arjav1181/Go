# Backup and recovery — go.

**Read this first.** Nothing in this repository proves that backups are running or
that a restore works. Both require configuration in a real Supabase project. This
document describes the procedure, states what has actually been verified, and is
explicit about what has not.

## Where the data lives

All state is in a single **Supabase Postgres** project:

| Table | Contents | Loss impact |
|---|---|---|
| `links` | Destinations, titles, expiry, activation | High |
| `link_rules`, `link_schedules`, `link_variants` | Routing behaviour | High |
| `link_experiments`, `experiment_config_versions`, `experiment_outcomes` | Experiment history and reproducibility | Medium |
| `daily_click_stats`, `experiment_daily_stats` | Aggregate click counts | Medium |
| `tags`, `folders`, join tables | Organisation | Low |
| `api_keys` | Hashed keys and scopes | High (security) |
| `owner_settings` | Retention and aggregation preferences | Low |
| `rate_limit_buckets`, `operational_events` | Transient operational data | None |

The Postgres data directory is the only thing that needs backing up. Supabase
handles authentication separately.

> Verified during launch review: all ten migrations in `supabase/migrations/`
> were applied in order to a clean Postgres and the resulting schema inspected —
> 18 tables, all with row level security enabled and no policies, plus 9
> functions. The SQL is correct; what is *unverified* is the Supabase-managed
> backup that sits in front of it.

## Strategy

Use the provider's managed backup rather than self-managed dumps, because it is
the mechanism the platform actually operates and tests.

| Aspect | Setting |
|---|---|
| Mechanism | Supabase managed backups + Point-in-Time Recovery (PITR) |
| Frequency | Continuous WAL archiving (PITR) — recovery point measured in minutes |
| Full backups | Daily, retained by the provider |
| Retention | As configured on the Supabase project; **verify in the dashboard** |
| Protection | Point-in-time recovery requires the project's own backup retention; a separate off-platform copy is **not** configured |
| Cross-region copy | **Not configured** |

### Verification status

| Item | Status |
|---|---|
| Backups enabled on the project | **UNVERIFIED** — requires your Supabase project |
| PITR available on the chosen plan | **UNVERIFIED** — plan dependent |
| Retention window known | **UNVERIFIED** |
| A restore has been performed | **NOT DONE** in this repository |
| Database restored into a separate project | **NOT DONE** in this repository |
| All migrations apply cleanly | **VERIFIED** — all ten files applied in order against a real Postgres |

Treat all four rows as open until you confirm them.

## Restoration drill (safe, isolated)

Run this against a **separate, empty Supabase project**. Never against production.

```bash
# 1. Create a scratch project in the Supabase dashboard.
#    Note its connection string and project ref.

# 2. Install the Postgres client if needed.
#    apt-get install postgresql-client   # or use your platform's package manager

# 3. Take a logical snapshot of PRODUCTION (read-only).
pg_dump \
  --host=<PROD_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --no-owner \
  --no-privileges \
  --format=custom \
  --file=go-backup-$(date -u +%Y%m%dT%H%M%SZ).dump

# 4. Restore into the SCRATCH project. This replaces its contents.
pg_restore \
  --host=<SCRATCH_DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  go-backup-*.dump

# 5. Verify row counts on the scratch database.
psql --host=<SCRATCH_DB_HOST> --username=postgres --dbname=postgres -c "
  select 'links' as table_name, count(*) from public.links
  union all select 'daily_click_stats', count(*) from public.daily_click_stats
  union all select 'link_rules', count(*) from public.link_rules
  union all select 'api_keys', count(*) from public.api_keys
  union all select 'experiments', count(*) from public.link_experiments;
"
```

### What to check after a restore

1. Counts are plausible and match the snapshot taken just before the restore.
2. Migrations are consistent — every file in `supabase/migrations/` has been
   applied. Compare `schema_migrations` against the directory listing.
3. The application starts against the scratch project and `/api/ready` reports
   `ready: true`.
4. A short link from the restored data resolves to the expected destination.
5. Owner sign-in works (auth is separate from the database; you must reproduce
   the auth user separately — a `pg_dump` does **not** contain Supabase Auth
   users).

**Point 5 is the most commonly missed step.** The database and the auth users are
restored independently.

### Point-in-time recovery alternative

If PITR is enabled, restoring to a specific moment is supported from the
Supabase dashboard. This is faster and more reliable than `pg_restore` for small
incidents. Use the dump/restore path above for a full independent copy.

## Recovery objectives

These are **targets**, not measured values. Actual numbers depend on your Supabase
plan and configuration.

| Objective | Target | Depends on |
|---|---|---|
| RPO (max data loss) | ≤ 24h worst case; minutes with PITR | Backup/PITR configuration |
| RTO (time to restore) | ≤ 4h manual | Procedure familiarity |
| Backup verification | After every configuration change | Manual |

## Recovery procedures

### A single link was deleted or overwritten

1. Do not panic; take a snapshot first.
2. Restore to a scratch database.
3. Copy the missing row(s) back, preserving `id` and `created_by`.
4. Re-verify the redirect before deleting the scratch database.

### Aggregate statistics were purged by retention

Retention deletes click history permanently and this is working as designed.
Archived experiment outcomes in `experiment_outcomes` are **not** subject to the
click-history purge, so experiment results survive. Restoring purged daily stats
requires a restore from before the purge.

### An API key was exposed

This is not a restore problem:
1. Revoke the key in `/settings` (immediate effect).
2. Issue a replacement with the same scopes using **Rotate**.
3. Remove the owner from `OWNER_EMAILS` if the exposure was via an owner account
   rather than the key store.

### The service role key was exposed

1. Rotate it in the Supabase dashboard immediately.
2. Redeploy with the new value.
3. Treat previously stored API keys as still valid — key hashes are unaffected by
   service-role rotation, and the keys remain valid by design.

## Recovery drill log

Record each drill here so the next person knows what was actually tested.

| Date | Environment | Result | Notes |
|---|---|---|---|
| — | — | Not yet performed | — |

## Limitations

- A logical dump does **not** include Supabase Auth users, storage objects, or
  project settings.
- Cross-region or off-platform copies are **not** configured, so a provider-level
  failure affecting a whole region is not covered.
- The backup schedule and retention window live in the Supabase project, not in
  this repository, so they can drift without a code review noticing.