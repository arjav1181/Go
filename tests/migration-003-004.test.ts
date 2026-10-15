import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const engine = readFileSync(join(process.cwd(), 'supabase/migrations/0003_redirect_engine.sql'), 'utf8');
const api = readFileSync(join(process.cwd(), 'supabase/migrations/0004_api_keys_and_alias_domains.sql'), 'utf8');

test('schedule windows are constrained to end after they start', () => {
  assert.match(engine, /constraint link_schedules_window_valid check \(ends_at is null or ends_at > starts_at\)/i);
});

test('schedules cascade when their link is deleted', () => {
  assert.match(engine, /link_id uuid not null references public\.links \(id\) on delete cascade/i);
});

test('variant weights are bounded 0-100', () => {
  assert.match(engine, /constraint link_variants_weight_valid check \(weight >= 0 and weight <= 100\)/i);
});

test('variant labels are unique per link and charset-constrained', () => {
  assert.match(engine, /constraint link_variants_label_format check/i);
  assert.match(engine, /constraint link_variants_link_label_unique unique \(link_id, label\)/i);
});

test('click stats gain a variant dimension without storing visitor identity', () => {
  assert.match(engine, /add column if not exists variant_label text not null default ''/i);
  assert.match(
    engine,
    /unique \(link_id, day, referrer_host, device_category, variant_label\)/i
  );
  // Still no IP or raw user-agent columns.
  assert.equal(/ip_address/i.test(engine), false);
  assert.equal(/user_agent/i.test(engine), false);
});

test('the increment function is replaced with a variant-aware signature', () => {
  assert.match(engine, /drop function if exists public\.increment_click\(uuid, date, text, text\)/i);
  assert.match(engine, /p_variant_label text default ''/i);
  assert.match(engine, /on conflict \(link_id, day, referrer_host, device_category, variant_label\)/i);
});

test('increment function privileges stay restricted to service_role', () => {
  assert.match(engine, /revoke all on function public\.increment_click\(uuid, date, text, text, text\) from public/i);
  assert.match(engine, /grant execute on function public\.increment_click\(uuid, date, text, text, text\) to service_role/i);
});

test('engine tables have row level security enabled', () => {
  const matches = engine.match(/enable row level security/gi) ?? [];
  assert.equal(matches.length, 2);
});

// --- API keys --------------------------------------------------------------

test('api key table never stores a plaintext key column', () => {
  assert.match(api, /create table if not exists public\.api_keys/i);
  assert.match(api, /key_hash text not null/i);
  // A plaintext column would be a serious regression.
  assert.equal(/\bkey text not null\b/i.test(api), false);
});

test('api key hashes are unique and indexed by owner', () => {
  assert.match(api, /create unique index if not exists api_keys_hash_uidx/i);
  assert.match(api, /create index if not exists api_keys_owner_idx/i);
});

test('api keys carry the owner email for allowlist re-checks', () => {
  assert.match(api, /owner_email text not null/i);
});

test('api keys have row level security enabled', () => {
  assert.match(api, /alter table public\.api_keys enable row level security/i);
});

test('links gain an alias domain column with a default', () => {
  assert.match(api, /add column if not exists domain text not null default ''/i);
});

test('alias domain lookups are indexed', () => {
  assert.match(api, /create index if not exists links_domain_slug_idx on public\.links \(domain, slug\)/i);
});