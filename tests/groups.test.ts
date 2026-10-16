import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyGroupName,
  isValidGroupSlug,
  scopeToGroup,
  MAX_GROUPS_PER_ACCOUNT,
  GROUP_ROLES,
  SLUG_PATTERN
} from '../lib/tenancy/permissions';

describe('group slugs', () => {
  it('slugifies ordinary names', () => {
    assert.equal(slugifyGroupName('Marketing Team'), 'marketing-team');
    assert.equal(slugifyGroupName('  Sales & Ops  '), 'sales-ops');
    assert.equal(slugifyGroupName('Engineering_2026'), 'engineering_2026');
  });

  it('returns null rather than a lossy fallback', () => {
    // Rejected at the form, not silently given an unusable address.
    assert.equal(slugifyGroupName('日本語'), null);
    assert.equal(slugifyGroupName('!!!'), null);
    assert.equal(slugifyGroupName('a'), null, 'below the minimum length');
    assert.equal(slugifyGroupName(''), null);
  });

  it('truncates to the documented maximum', () => {
    const long = 'x'.repeat(200);
    const slug = slugifyGroupName(long);
    assert.ok(slug && slug.length <= 64, `${slug?.length} should be <= 64`);
  });

  it('validates against the same pattern the check constraint uses', () => {
    // The migration enforces this in SQL; the TS check must agree or a form
    // would accept a name the database then rejects.
    for (const ok of ['abc', 'a-b_c', 'x'.repeat(64)]) {
      assert.equal(isValidGroupSlug(ok), true, ok);
    }
    for (const bad of ['ab', 'A-B', 'a b', 'a.b', 'x'.repeat(65), '', 'a/b']) {
      assert.equal(isValidGroupSlug(bad), false, bad);
    }
  });

  it('exports the pattern used by the constraint', () => {
    assert.equal(SLUG_PATTERN.source, '^[a-z0-9_-]{3,64}$');
  });
});

describe('group scoping', () => {
  const rows = [
    { id: '1', group_id: null },
    { id: '2', group_id: 'g1' },
    { id: '3', group_id: 'g2' }
  ];

  it('returns everything when no group is active', () => {
    assert.equal(scopeToGroup(rows, null).length, 3);
  });

  it('includes unassigned rows so pre-tenancy links are not hidden', () => {
    // This is the whole reason the column is nullable: every row created
    // before 0016 has group_id NULL, and filtering those out would make links
    // vanish the moment a group was selected.
    const scoped = scopeToGroup(rows, 'g1');
    assert.deepEqual(scoped.map((r) => r.id).sort(), ['1', '2']);
  });

  it('excludes rows belonging to another group', () => {
    const scoped = scopeToGroup(rows, 'g2');
    assert.equal(scoped.some((r) => r.id === '2'), false);
  });
});

describe('tenancy constants', () => {
  it('matches the roles the check constraint allows', () => {
    assert.deepEqual([...GROUP_ROLES], ['owner', 'admin', 'editor', 'viewer']);
  });

  it('matches the documented group limit enforced by the trigger', () => {
    // Mirrors `enforce_group_limit` in 0016. If either moves, the other must.
    assert.equal(MAX_GROUPS_PER_ACCOUNT, 150);
  });
});