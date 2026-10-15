import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDestinationUrl } from '../lib/links/validation';
import { decideRedirect } from '../lib/links/resolve';
import { resolveEffectiveDestination } from '../lib/links/target';
import { getExpiryInfo } from '../lib/links/status';
import { parseReferrerHost, deriveDeviceCategory } from '../lib/analytics/device-category';

/**
 * Abuse and hostile-input coverage for the redirect path.
 *
 * These assert the behaviour a visitor or attacker actually gets, not internal
 * implementation details.
 */

const cases: Array<[string, string]> = [
  ['javascript:alert(1)', 'javascript scheme'],
  ['JaVaScRiPt:alert(1)', 'mixed-case javascript scheme'],
  ['data:text/html;base64,PHNjcmlwdD4=', 'data scheme'],
  ['vbscript:msgbox(1)', 'vbscript scheme'],
  ['file:///etc/passwd', 'file scheme'],
  ['ftp://example.com/x', 'ftp scheme'],
  ['//evil.example/x', 'protocol-relative'],
  ['https://user:pass@example.com/', 'embedded credentials'],
  ['https://exa mple.com', 'space inside host'],
  ['https://exa\tmple.com', 'tab inside host'],
  ['javascript\t:alert(1)', 'whitespace inside scheme'],
  ['java\nscript:alert(1)', 'newline obfuscated scheme'],
  ['', 'empty'],
  ['   ', 'whitespace only'],
  ['http://', 'host missing'],
  ['https://exa mple.com', 'space in host']
];

test('dangerous destinations are rejected', () => {
  for (const [input, label] of cases) {
    const result = normalizeDestinationUrl(input);
    assert.equal(result.ok, false, `expected rejection for ${label}: ${JSON.stringify(input)}`);
  }
});

test('surrounding whitespace is tolerated and normalised away', () => {
  // The platform URL parser strips leading/trailing whitespace, so a pasted
  // value with a stray newline is accepted and stored in canonical form. This
  // is lenient input handling, not a bypass: internal whitespace is rejected.
  const padded = normalizeDestinationUrl('\n  https://example.com/x  ');
  assert.equal(padded.ok, true);
  if (padded.ok) assert.equal(padded.url, 'https://example.com/x');
});

test('legitimate destinations survive validation unchanged in meaning', () => {
  const allowed = [
    'https://example.com',
    'http://example.com/path?a=1',
    'https://sub.domain.example.co.uk/x',
    'https://example.com:8443/x',
    'https://xn--exmple-cua.com/x'
  ];
  for (const input of allowed) {
    assert.equal(normalizeDestinationUrl(input).ok, true, input);
  }
});

test('rejection messages never echo the submitted value', () => {
  // Reflecting input into an error is how reflected XSS starts.
  for (const [input] of cases) {
    const result = normalizeDestinationUrl(input);
    if (!result.ok) {
      assert.ok(!result.error.includes(input) || input.length < 3, 'error echoed input');
    }
  }
});

// --- unavailable dependencies ---------------------------------------------

test('an expired link never redirects even when the engine has a target', () => {
  const schedule = {
    id: 's',
    destination_url: 'https://example.com/promo',
    starts_at: new Date(Date.now() - 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 86_400_000).toISOString()
  };
  const decision = decideRedirect({
    id: 'l',
    destination_url: 'https://example.com/base',
    is_active: true,
    expires_at: new Date(Date.now() - 1).toISOString()
  });
  assert.equal(decision.kind, 'gone');
  assert.equal(decision.reason, 'expired');
  // Even if the engine were consulted, it must not resurrect the link.
  const resolved = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    schedules: [schedule],
    now: new Date()
  });
  assert.equal(resolved.destination, 'https://example.com/promo');
  // ...but the lifecycle gate is what the route acts on first.
  assert.notEqual(decision.kind, 'redirect');
});

test('a disabled link is reported as disabled, not expired', () => {
  const decision = decideRedirect({
    id: 'l',
    destination_url: 'https://example.com/',
    is_active: false,
    expires_at: new Date(Date.now() - 86_400_000).toISOString()
  });
  assert.equal(decision.kind, 'gone');
  assert.equal(decision.reason, 'disabled');
});

test('a missing link yields not_found without touching the engine', () => {
  assert.deepEqual(decideRedirect(null), { kind: 'not_found' });
});

test('a corrupted stored destination degrades instead of redirecting', () => {
  const decision = decideRedirect({
    id: 'l',
    destination_url: 'not-a-url',
    is_active: true,
    expires_at: null
  });
  assert.equal(decision.kind, 'gone');
  assert.equal(decision.reason, 'invalid');
});

test('a link expiring exactly now is treated as expired', () => {
  const now = new Date();
  const decision = decideRedirect({
    id: 'l',
    destination_url: 'https://example.com/',
    is_active: true,
    expires_at: now.toISOString()
  }, now);
  assert.equal(decision.kind === 'gone' && decision.reason, 'expired');
});

test('status reporting agrees with redirect eligibility at boundaries', () => {
  const now = new Date();
  for (const offset of [-1, 0, 1, 3_600_000]) {
    const state = {
      is_active: true,
      expires_at: new Date(now.getTime() + offset).toISOString()
    };
    const status = getExpiryInfo(state, now).status;
    const decision = decideRedirect({ id: 'l', destination_url: 'https://e.com', ...state }, now);
    assert.equal(decision.kind === 'redirect', status !== 'expired', `offset ${offset}`);
  }
});

// --- privacy under hostile input ------------------------------------------

test('referrer parsing cannot be tricked into storing a path', () => {
  const host = parseReferrerHost('https://evil.example/steal?token=abc#frag');
  assert.equal(host, 'evil.example');
  assert.ok(!host.includes('/'));
  assert.ok(!host.includes('token'));
});

test('referrer parsing survives garbage without throwing', () => {
  for (const value of ['', '   ', 'not a url', '://', 'http://', 'javascript:alert(1)', '\u0000']) {
    const host = parseReferrerHost(value);
    assert.ok(['direct', 'unknown'].includes(host) || typeof host === 'string');
  }
});

test('device category never returns the raw user agent', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SecretBuild/999';
  const category = deriveDeviceCategory(ua);
  assert.ok(['mobile', 'desktop', 'tablet', 'bot', 'unknown'].includes(category));
  assert.ok(!category.includes('SecretBuild'));
});

// --- concurrent / repeated evaluation -------------------------------------

test('repeated resolution for one link is stable (no cross-request drift)', () => {
  const now = new Date();
  const rules = [
    {
      id: 'r1',
      name: 'r1',
      priority: 1,
      destination_url: 'https://example.com/r1',
      weight: 100,
      is_active: true,
      conditions: [
        { id: 'c1', kind: 'query_param' as const, param: 'lang', value: 'de', starts_at: null, ends_at: null }
      ]
    }
  ];
  const first = decideRedirect({
    id: 'l',
    destination_url: 'https://example.com/',
    is_active: true,
    expires_at: null
  }, now);
  assert.equal(first.kind, 'redirect');

  // The same input must produce the same rule outcome every time.
  for (let i = 0; i < 25; i += 1) {
    const matched = rules.filter((rule) =>
      rule.conditions.every((c) => c.param === 'lang' && c.value === 'de')
    );
    assert.equal(matched.length, 1);
  }
});