import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0001_init.sql'), 'utf8');

test('links.slug has a unique constraint', () => {
  assert.match(sql, /unique index[^;]*links_slug_uidx/i);
});

test('daily stats enforce an aggregate unique key', () => {
  assert.match(sql, /unique \(link_id, day, referrer_host, device_category\)/i);
});

test('click increments use an atomic upsert', () => {
  assert.match(sql, /increment_click/i);
  assert.match(sql, /on conflict/i);
});

test('row level security is enabled on both tables', () => {
  const matches = sql.match(/enable row level security/gi) ?? [];
  assert.equal(matches.length, 2);
});

test('analytics table stores no ip or user agent columns', () => {
  assert.equal(/ip_address/i.test(sql), false);
  assert.equal(/user_agent/i.test(sql), false);
});
