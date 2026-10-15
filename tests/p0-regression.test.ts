import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRedirect } from '../lib/links/resolve';
import { isRedirectEligible, getExpiryInfo } from '../lib/links/status';
import { validateCustomSlug, normalizeDestinationUrl } from '../lib/links/validation';
import { deriveDeviceCategory, parseReferrerHost } from '../lib/analytics/device-category';

const HOUR = 3_600_000;
const NOW = new Date('2026-05-01T12:00:00.000Z');

/**
 * P1 added a status helper for the UI. The redirect path (decideRedirect) must
 * remain the authority, so the two can never disagree about whether a link
 * may redirect.
 */
test('UI status never disagrees with the authoritative redirect decision', () => {
  const states = [
    { is_active: true, expires_at: null },
    { is_active: false, expires_at: null },
    { is_active: true, expires_at: new Date(NOW.getTime() + 30 * 24 * HOUR).toISOString() },
    { is_active: true, expires_at: new Date(NOW.getTime() + HOUR).toISOString() },
    { is_active: true, expires_at: new Date(NOW.getTime() - HOUR).toISOString() },
    { is_active: false, expires_at: new Date(NOW.getTime() - HOUR).toISOString() },
    { is_active: true, expires_at: NOW.toISOString() }
  ];

  for (const state of states) {
    const link = { id: 'id', destination_url: 'https://example.com/', ...state };
    const decision = decideRedirect(link, NOW);
    const eligible = isRedirectEligible(state, NOW);

    assert.equal(
      decision.kind === 'redirect',
      eligible,
      `mismatch for ${JSON.stringify(state)}: redirect=${decision.kind} ui=${getExpiryInfo(state, NOW).status}`
    );
  }
});

test('expired links still do not redirect (P0 behaviour preserved)', () => {
  const decision = decideRedirect(
    {
      id: 'id',
      destination_url: 'https://example.com/',
      is_active: true,
      expires_at: new Date(NOW.getTime() - 1).toISOString()
    },
    NOW
  );
  assert.equal(decision.kind, 'gone');
});

test('disabled links still do not redirect (P0 behaviour preserved)', () => {
  const decision = decideRedirect(
    { id: 'id', destination_url: 'https://example.com/', is_active: false, expires_at: null },
    NOW
  );
  assert.equal(decision.kind, 'gone');
});

test('active links still redirect to the destination (P0 behaviour preserved)', () => {
  const decision = decideRedirect(
    { id: 'id', destination_url: 'https://example.com/target', is_active: true, expires_at: null },
    NOW
  );
  assert.deepEqual(decision, { kind: 'redirect', location: 'https://example.com/target' });
});

test('slug rules are unchanged by P1 (P0 regression)', () => {
  assert.equal(validateCustomSlug('valid-slug').ok, true);
  assert.equal(validateCustomSlug('dashboard').ok, false);
  assert.equal(validateCustomSlug('ab').ok, false);
  assert.equal(validateCustomSlug('has space').ok, false);
});

test('destination rules are unchanged by P1 (P0 regression)', () => {
  assert.equal(normalizeDestinationUrl('https://example.com').ok, true);
  assert.equal(normalizeDestinationUrl('javascript:alert(1)').ok, false);
  assert.equal(normalizeDestinationUrl('data:text/html,x').ok, false);
  assert.equal(normalizeDestinationUrl('file:///etc/passwd').ok, false);
  assert.equal(normalizeDestinationUrl('https://go.arjav.is-cool.dev/x', 'go.arjav.is-cool.dev').ok, false);
});

test('privacy guarantees are unchanged by P1 (P0 regression)', () => {
  // Referrer is reduced to a hostname; device is a coarse label.
  assert.equal(parseReferrerHost('https://a.example/p?q=1#f'), 'a.example');
  assert.equal(parseReferrerHost(null), 'direct');
  assert.equal(deriveDeviceCategory('Googlebot/2.1'), 'bot');
  assert.equal(deriveDeviceCategory(null), 'unknown');
});

test('tag validation never accepts characters that could break a slug-like path', () => {
  // Tags/folders are metadata only; they must not be usable as slugs.
  for (const bad of ['a/b', 'a\\b', '../etc']) {
    assert.equal(validateCustomSlug(bad).ok, false);
  }
});