import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const purgeRoute = readFileSync(join(process.cwd(), 'app/api/cron/purge/route.ts'), 'utf8');
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0005_retention.sql'), 'utf8');
const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));

test('purge is gated on CRON_SECRET', () => {
  assert.match(purgeRoute, /process\.env\.CRON_SECRET/);
  assert.match(purgeRoute, /Bearer/);
});

test('purge fails closed when CRON_SECRET is missing or too short', () => {
  // Without this guard a misconfigured deployment would delete data unauthenticated.
  assert.match(purgeRoute, /if \(!secret \|\| secret\.length < 16\)/);
  assert.match(purgeRoute, /status: 503/);
});

test('purge rejects requests without a bearer secret', () => {
  assert.match(purgeRoute, /status: 401/);
  assert.match(purgeRoute, /Unauthorized/);
});

test('purge compares the secret in constant time', () => {
  assert.match(purgeRoute, /safeHashEquals/);
});

test('purge only deletes rows strictly older than the cutoff', () => {
  assert.match(purgeRoute, /\.lt\('day', cutoff\)/);
});

test('purge is scoped to the owner\'s own links', () => {
  assert.match(purgeRoute, /\.eq\('created_by', target\.ownerId\)/);
});

test('purge never runs for owners with retention disabled', () => {
  assert.match(purgeRoute, /listRetentionEnabledOwners/);
  assert.match(purgeRoute, /shouldPurge/);
});

test('purge does not delete links or schedules', () => {
  // Only the aggregate stats table may be deleted.
  const deletes = purgeRoute.match(/from\('([^']+)'\)\s*\n?\s*\.delete/g) ?? [];
  assert.equal(deletes.length, 1);
  assert.match(deletes[0], /daily_click_stats/);
});

test('retention defaults to disabled at the schema level', () => {
  assert.match(sql, /retention_enabled boolean not null default false/i);
});

test('retention days are bounded by a check constraint', () => {
  assert.match(
    sql,
    /constraint owner_settings_retention_days_range check \(\s*retention_days >= 1 and retention_days <= 3650\s*\)/i
  );
});

test('settings are keyed per owner', () => {
  assert.match(sql, /owner_id uuid primary key/i);
});

test('settings table has row level security enabled', () => {
  assert.match(sql, /alter table public\.owner_settings enable row level security/i);
});

test('purge query is supported by a day index', () => {
  assert.match(sql, /create index if not exists daily_click_stats_day_idx on public\.daily_click_stats \(day\)/i);
});

test('cron schedule runs daily and targets the purge endpoint', () => {
  const crons = vercel.crons ?? [];
  assert.equal(crons.length, 1);
  assert.equal(crons[0].path, '/api/cron/purge');
  // Five-field daily schedule; Vercel Hobby permits once per day.
  assert.match(crons[0].schedule, /^\d+ \d+ \* \* \*$/);
});