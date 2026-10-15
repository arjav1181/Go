import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { RESERVED_SLUGS, validateCustomSlug } from '../lib/links/validation';

/**
 * Guard against route/slug collisions.
 *
 * Next.js matches a static segment before a dynamic `[slug]` segment, so a link
 * created with a slug that is also an application route is silently shadowed:
 * the dashboard page wins and the short link never redirects. The link looks
 * healthy in the UI and is simply dead.
 *
 * These tests derive the real route list from `app/` so a newly added page
 * cannot be added without also reserving its slug.
 */

const APP_DIR = join(process.cwd(), 'app');

function routeSegments(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name;
    // Route groups `(app)` and parallel routes do not form URL segments.
    if (name.startsWith('(') || name.startsWith('@') || name.startsWith('_')) continue;

    if (entry.isDirectory()) {
      // Dynamic segments never collide with a literal slug.
      if (name.startsWith('[')) continue;
      found.push(...routeSegments(join(dir, name), `${prefix}/${name}`));
      continue;
    }

    if (name === 'page.tsx' || name === 'page.ts' || name === 'route.ts') {
      // Only single-segment routes can collide. The short-link route is a
      // single dynamic segment at the root, so `/api/cron/purge` can never be
      // shadowed by a slug `purge`: that would resolve to `/purge`, which is a
      // different URL.
      const segments = prefix.split('/').filter(Boolean);
      if (segments.length === 1) found.push(segments[0]);
    }
  }

  return found;
}

test('every top-level application route is a reserved slug', () => {
  const routes = [...new Set(routeSegments(APP_DIR))].sort();
  assert.ok(routes.length > 0, 'no routes discovered - test would pass vacuously');

  const missing = routes.filter((route) => !RESERVED_SLUGS.has(route));
  assert.deepEqual(
    missing,
    [],
    `these app routes are not reserved, so a short link could be created that is then unreachable: ${missing.join(', ')}`
  );
});

test('the known collision is covered: a slug named "tags" is rejected', () => {
  // Regression test. `app/tags/page.tsx` exists and "tags" was claimable.
  const result = validateCustomSlug('tags');
  assert.equal(result.ok, false);
});

test('reserved slugs are rejected regardless of case or padding', () => {
  for (const reserved of ['dashboard', 'api', 'login', 'privacy', 'settings']) {
    assert.equal(validateCustomSlug(reserved).ok, false, reserved);
    assert.equal(validateCustomSlug(reserved.toUpperCase()).ok, false, reserved);
    assert.equal(validateCustomSlug(`  ${reserved}  `).ok, false, reserved);
  }
});

test('real, unreserved slugs are still accepted', () => {
  for (const slug of ['hello', 'my-link', 'a_b', 'link2024', 'goo', 'x9y8z7']) {
    assert.equal(validateCustomSlug(slug).ok, true, slug);
  }
});

test('reserved entries are themselves valid slug syntax', () => {
  // A reserved value that could never be produced by validateCustomSlug (e.g.
  // containing uppercase or a slash) would be dead weight and hide a mistake.
  for (const reserved of RESERVED_SLUGS) {
    assert.match(reserved, /^[a-z0-9_-]+$/, `unusable reserved slug: ${reserved}`);
    assert.equal(reserved, reserved.toLowerCase(), 'reserved slugs must be lowercase');
  }
});

test('the reserved list has no redundant entries', () => {
  const entries = [...RESERVED_SLUGS];
  assert.equal(entries.length, new Set(entries).size);
});
