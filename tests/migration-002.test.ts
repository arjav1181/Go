import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0002_tags_folders.sql'), 'utf8');

test('tags, folders and both join tables exist', () => {
  for (const table of ['public.tags', 'public.folders', 'public.link_tags', 'public.link_folders']) {
    assert.match(sql, new RegExp(`create table if not exists ${table.replace('.', '\\.')}`, 'i'));
  }
});

test('tag names are unique per owner', () => {
  assert.match(sql, /create unique index if not exists tags_owner_name_uidx/i);
});

test('folder names are unique per owner', () => {
  assert.match(sql, /create unique index if not exists folders_owner_name_uidx/i);
});

test('unique indexes coalesce a null owner id', () => {
  // Without coalesce, NULL created_by values would never conflict.
  const uniqueIndexes = sql.match(/coalesce\(created_by[^\n]*/gi) ?? [];
  assert.equal(uniqueIndexes.length, 2);
});

test('deleting a tag or folder never deletes links', () => {
  assert.match(sql, /tag_id uuid not null references public\.tags \(id\) on delete cascade/i);
  assert.match(sql, /folder_id uuid not null references public\.folders \(id\) on delete cascade/i);
  // The cascade is from the join table to the label, and from a link to its join rows.
  assert.match(sql, /link_id uuid not null references public\.links \(id\) on delete cascade/i);
});

test('nested folders detach rather than delete children', () => {
  assert.match(sql, /parent_id uuid references public\.folders \(id\) on delete set null/i);
});

test('row level security is enabled on all four new tables', () => {
  const matches = sql.match(/enable row level security/gi) ?? [];
  assert.equal(matches.length, 4);
});

test('label names are constrained to a safe character set', () => {
  assert.match(sql, /constraint tags_name_format check/i);
  assert.match(sql, /constraint folders_name_format check/i);
});

test('lookups by label are indexed', () => {
  assert.match(sql, /create index if not exists link_tags_tag_idx/i);
  assert.match(sql, /create index if not exists link_folders_folder_idx/i);
});