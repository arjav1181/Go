import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRedirect, type LinkRow, type RedirectDecision } from '../lib/links/resolve';
import { resolveEffectiveDestination, type Variant, type ScheduleWindow } from '../lib/links/target';

const HOUR = 3_600_000;
const NOW = new Date('2026-06-15T12:00:00.000Z');

type Outcome = RedirectDecision | ReturnType<typeof resolveEffectiveDestination>;

/**
 * The redirect route evaluates the lifecycle BEFORE the redirect engine.
 * These tests prove a schedule or variant can never resurrect a link that the
 * lifecycle rules have already rejected.
 */
function resolve(
  link: Omit<LinkRow, 'id'>,
  schedules: ScheduleWindow[] = [],
  variants: Variant[] = [],
  now: Date = NOW
): Outcome {
  const decision = decideRedirect({ id: 'test-link', ...link }, now);
  if (decision.kind !== 'redirect') return decision;
  return resolveEffectiveDestination({
    linkDestination: decision.location,
    schedules,
    variants,
    now
  });
}

const redirects = (outcome: Outcome) => 'kind' in outcome ? outcome.kind === 'redirect' : true;

const promoSchedule: ScheduleWindow = {
  id: 'promo',
  destination_url: 'https://example.com/promo',
  starts_at: new Date(NOW.getTime() - HOUR).toISOString(),
  ends_at: new Date(NOW.getTime() + HOUR).toISOString()
};

const variantA: Variant = {
  id: 'a',
  label: 'a',
  destination_url: 'https://example.com/a',
  weight: 100,
  is_active: true
};

test('an expired link is not redirected even with an active schedule', () => {
  const result = resolve(
    { is_active: true, expires_at: new Date(NOW.getTime() - HOUR).toISOString(), destination_url: 'https://example.com/base' },
    [promoSchedule],
    [variantA]
  );
  assert.equal('kind' in result && result.kind, 'gone');
});

test('a disabled link is not redirected even with an active schedule', () => {
  const result = resolve(
    { is_active: false, expires_at: null, destination_url: 'https://example.com/base' },
    [promoSchedule],
    [variantA]
  );
  assert.equal('kind' in result && result.kind, 'gone');
});

test('a link expiring in the future still redirects through the engine', () => {
  const result = resolve(
    { is_active: true, expires_at: new Date(NOW.getTime() + 30 * 24 * HOUR).toISOString(), destination_url: 'https://example.com/base' },
    [],
    [variantA]
  );
  assert.equal('source' in result && result.source, 'variant');
});

test('a plain link with no rules still redirects to its own destination', () => {
  const result = resolve({ is_active: true, expires_at: null, destination_url: 'https://example.com/base' });
  assert.deepEqual(result, { destination: 'https://example.com/base', source: 'link', label: null });
});

test('a missing link stays not found regardless of schedules', () => {
  const decision = decideRedirect(null, NOW);
  assert.equal(decision.kind, 'not_found');
});


test('schedules and variants never change disabled/expiry semantics', () => {
  // Same matrix as the P1 regression, now with rules attached.
  const states = [
    { is_active: true, expires_at: null },
    { is_active: false, expires_at: null },
    { is_active: true, expires_at: new Date(NOW.getTime() + 10 * 24 * HOUR).toISOString() },
    { is_active: true, expires_at: new Date(NOW.getTime() - HOUR).toISOString() },
    { is_active: false, expires_at: new Date(NOW.getTime() - HOUR).toISOString() }
  ];
  for (const state of states) {
    const withRules = resolve({ ...state, destination_url: 'https://example.com/base' }, [promoSchedule], [variantA]);
    const withoutRules = resolve({ ...state, destination_url: 'https://example.com/base' });
    assert.equal(
      redirects(withRules),
      redirects(withoutRules),
      `lifecycle mismatch for ${JSON.stringify(state)}`
    );
  }
});

test('variant selection is reported so analytics can be grouped by variant', () => {
  const result = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    variants: [variantA],
    now: NOW,
    random: () => 0.5
  });
  assert.equal(result.label, 'a');
  assert.equal(result.source, 'variant');
});

test('a schedule target carries no variant label', () => {
  const result = resolveEffectiveDestination({
    linkDestination: 'https://example.com/base',
    schedules: [promoSchedule],
    variants: [variantA],
    now: NOW
  });
  assert.equal(result.label, null);
  assert.equal(result.source, 'schedule');
});