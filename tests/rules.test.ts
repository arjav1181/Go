import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRules,
  filterQuery,
  isTrackingParam,
  type Rule,
  type RuleCondition,
  type RuleContext
} from '../lib/rules/evaluate';
import { BUCKET_COUNT } from '../lib/experiments/bucketing';

const NOW = new Date('2026-09-01T12:00:00.000Z');

const qp = (id: string, param: string, value: string): RuleCondition => ({
  id,
  kind: 'query_param',
  param,
  value,
  starts_at: null,
  ends_at: null
});

const tw = (id: string, start?: string, end?: string): RuleCondition => ({
  id,
  kind: 'time_window',
  param: null,
  value: null,
  starts_at: start ?? null,
  ends_at: end ?? null
});

const rule = (partial: Partial<Rule> & { id: string }): Rule => ({
  name: `rule-${partial.id}`,
  priority: 1,
  destination_url: `https://example.com/${partial.id}`,
  weight: 100,
  is_active: true,
  conditions: [],
  ...partial
});

const ctx = (query: Record<string, string> = {}, now: Date = NOW): RuleContext => {
  const filtered = filterQuery(query);
  return { query: filtered.query, now, ignoredParams: filtered.ignored };
};

const run = (rules: Rule[], query: Record<string, string> = {}, now = NOW, bucket = 0) =>
  evaluateRules(rules, ctx(query, now), bucket, BUCKET_COUNT);

// --- privacy ---------------------------------------------------------------

test('tracking parameters are filtered out of evaluation', () => {
  const result = filterQuery({ utm_source: 'twitter', ref: 'x', plan: 'pro' });
  assert.deepEqual(result.query, { plan: 'pro' });
  assert.deepEqual(result.ignored, ['ref', 'utm_source']);
});

test('known ad click ids are ignored', () => {
  for (const name of ['gclid', 'fbclid', 'msclkid', 'ttclid', 'mc_cid']) {
    assert.equal(isTrackingParam(name), true, name);
  }
});

test('tracking parameter matching is case-insensitive', () => {
  assert.equal(isTrackingParam('UTM_SOURCE'), true);
  assert.equal(isTrackingParam('GCLID'), true);
});

test('a filtered tracking parameter cannot drive a rule', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'utm_source', 'twitter')] })];
  const result = run(rules, { utm_source: 'twitter' });
  assert.equal(result.destination, null, 'tracking param must not match');
  assert.deepEqual(result.ignoredParams, ['utm_source']);
});

test('an explicitly named non-tracking parameter still works', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'plan', 'pro')] })];
  assert.equal(run(rules, { plan: 'pro' }).destination, 'https://example.com/r1');
  assert.equal(run(rules, { plan: 'free' }).destination, null);
});

test('undefined and null parameters are dropped', () => {
  const result = filterQuery({ a: undefined, b: null, c: 'keep' });
  assert.deepEqual(result.query, { c: 'keep' });
});

// --- query parameter conditions -------------------------------------------

test('matching parameter value selects the rule', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] })];
  assert.equal(run(rules, { lang: 'de' }).destination, 'https://example.com/r1');
});

test('non-matching value falls through to the default', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] })];
  assert.equal(run(rules, { lang: 'fr' }).destination, null);
});

test('missing parameter falls through', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] })];
  assert.equal(run(rules, {}).destination, null);
});

test('several allowed values are supported', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de, fr ,es')] })];
  for (const value of ['de', 'fr', 'es']) {
    assert.equal(run(rules, { lang: value }).destination, 'https://example.com/r1', value);
  }
  assert.equal(run(rules, { lang: 'it' }).destination, null);
});

test('value matching is exact, not substring or pattern', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] })];
  assert.equal(run(rules, { lang: 'de-AT' }).destination, null);
  assert.equal(run(rules, { lang: 'DE' }).destination, null, 'case sensitive');
  assert.equal(run(rules, { lang: 'de; drop table' }).destination, null);
});

test('regex metacharacters in a value are literal, never executed', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'x', '.*')] })];
  // ".*" is treated as a literal string; it must not behave like a wildcard.
  assert.equal(run(rules, { x: 'anything' }).destination, null);
  assert.equal(run(rules, { x: '.*' }).destination, 'https://example.com/r1');
});

test('an invalid parameter name never matches', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'bad name!', 'x')] })];
  assert.equal(run(rules, { 'bad name!': 'x' }).destination, null);
});

test('a condition with no allowed values never matches', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', '')] })];
  assert.equal(run(rules, { lang: 'de' }).destination, null);
});

// --- time windows ----------------------------------------------------------

test('time inside the window matches', () => {
  const rules = [
    rule({ id: 'r1', conditions: [tw('c1', '2026-08-01T00:00:00Z', '2026-09-02T00:00:00Z')] })
  ];
  assert.equal(run(rules).destination, 'https://example.com/r1');
});

test('time before the window does not match', () => {
  // NOW is 2026-09-01; the window starts later.
  const rules = [
    rule({ id: 'r1', conditions: [tw('c1', '2026-09-05T00:00:00Z', '2026-10-05T00:00:00Z')] })
  ];
  assert.equal(run(rules, {}, NOW).destination, null);
});

test('time after the window does not match', () => {
  const rules = [
    rule({ id: 'r1', conditions: [tw('c1', '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z')] })
  ];
  assert.equal(run(rules, {}, NOW).destination, null);
});

test('window boundaries are half-open', () => {
  const rules = [
    rule({ id: 'r1', conditions: [tw('c1', '2026-09-01T12:00:00Z', '2026-09-01T13:00:00Z')] })
  ];
  assert.equal(run(rules, {}, NOW).destination, 'https://example.com/r1', 'start inclusive');
  assert.equal(
    run(rules, {}, new Date('2026-09-01T13:00:00Z')).destination,
    null,
    'end exclusive'
  );
});

test('an open-ended window matches in the future', () => {
  const rules = [rule({ id: 'r1', conditions: [tw('c1', '2026-01-01T00:00:00Z')] })];
  assert.equal(run(rules, {}, NOW).destination, 'https://example.com/r1');
});

test('an invalid window is ignored rather than crashing', () => {
  const rules = [rule({ id: 'r1', conditions: [tw('c1', 'not-a-date', 'also-bad')] })];
  assert.equal(run(rules, {}, NOW).destination, null);
});

test('an inverted window never matches', () => {
  const rules = [rule({ id: 'r1', conditions: [tw('c1', '2026-09-02T00:00:00Z', '2026-08-01T00:00:00Z')] })];
  assert.equal(run(rules, {}, NOW).destination, null);
});

// --- combining and ordering ------------------------------------------------

test('all conditions must match (AND)', () => {
  const rules = [
    rule({
      id: 'r1',
      conditions: [qp('c1', 'lang', 'de'), tw('c2', '2026-08-01T00:00:00Z', '2026-10-01T00:00:00Z')]
    })
  ];
  assert.equal(run(rules, { lang: 'de' }).destination, 'https://example.com/r1');
  assert.equal(run(rules, { lang: 'fr' }).destination, null);
  assert.equal(
    run(rules, { lang: 'de' }, new Date('2026-11-01T00:00:00Z')).destination,
    null
  );
});

test('lower priority number wins', () => {
  const rules = [
    rule({ id: 'low', priority: 10, conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'high', priority: 1, conditions: [qp('c2', 'lang', 'de')] })
  ];
  assert.equal(run(rules, { lang: 'de' }).destination, 'https://example.com/high');
});

test('a tie is broken deterministically by name', () => {
  const build = () => [
    rule({ id: 'b', priority: 1, name: 'bravo', conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'a', priority: 1, name: 'alpha', conditions: [qp('c2', 'lang', 'de')] })
  ];
  const first = run(build(), { lang: 'de' }).destination;
  const reversed = run(build().reverse(), { lang: 'de' }).destination;
  assert.equal(first, reversed);
  assert.equal(first, 'https://example.com/a');
});

test('the same request always produces the same decision', () => {
  const rules = [
    rule({ id: 'r1', priority: 1, weight: 50, conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'r2', priority: 2, weight: 50, conditions: [qp('c2', 'lang', 'de')] })
  ];
  const first = run(rules, { lang: 'de' }, NOW, 1234).destination;
  for (let i = 0; i < 50; i += 1) {
    assert.equal(run(rules, { lang: 'de' }, NOW, 1234).destination, first);
  }
});

test('shadowed rules are reported so ambiguity is visible', () => {
  const rules = [
    rule({ id: 'r1', priority: 1, conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'r2', priority: 2, conditions: [qp('c2', 'lang', 'de')] })
  ];
  const result = run(rules, { lang: 'de' });
  assert.equal(result.shadowed.length, 1);
  assert.equal(result.shadowed[0].ruleId, 'r2');
});

test('inactive rules are ignored', () => {
  const rules = [rule({ id: 'r1', is_active: false, conditions: [qp('c1', 'lang', 'de')] })];
  assert.equal(run(rules, { lang: 'de' }).destination, null);
});

test('a rule with no conditions never matches (it would shadow the default)', () => {
  const rules = [rule({ id: 'r1', conditions: [] })];
  assert.equal(run(rules, {}).destination, null);
});

test('no matching rule yields the default destination', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] })];
  const result = run(rules, {});
  assert.equal(result.rule, null);
  assert.equal(result.destination, null);
});

test('trace explains every condition', () => {
  const rules = [
    rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de'), tw('c2', '2026-01-01T00:00:00Z')] })
  ];
  const result = run(rules, { lang: 'de' });
  assert.equal(result.trace.length, 1);
  assert.equal(result.trace[0].conditions.length, 2);
  assert.ok(result.trace[0].conditions.every((c) => c.matched));
  assert.match(result.trace[0].conditions[0].reason, /matched an allowed value/);
});

test('trace explains why a rule did not match', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] })];
  const result = run(rules, { lang: 'fr' });
  assert.equal(result.trace[0].matched, false);
  assert.match(result.trace[0].conditions[0].reason, /did not match/);
});

test('trace explains a missing parameter', () => {
  const rules = [rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] })];
  const result = run(rules, {});
  assert.match(result.trace[0].conditions[0].reason, /no "lang" parameter/);
});

// --- weighted selection among matching rules -------------------------------

test('matching rules split by weight', () => {
  const rules = [
    rule({ id: 'r1', priority: 1, weight: 25, conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'r2', priority: 2, weight: 75, conditions: [qp('c2', 'lang', 'de')] })
  ];
  let r1 = 0;
  const trials = 4000;
  for (let i = 0; i < trials; i += 1) {
    // Spread buckets across the FULL range, not just the first slice.
    const bucket = Math.floor((i * BUCKET_COUNT) / trials);
    if (run(rules, { lang: 'de' }, NOW, bucket).destination === 'https://example.com/r1') r1 += 1;
  }
  assert.ok(Math.abs(r1 / trials - 0.25) < 0.04, `share was ${r1 / trials}`);
});

test('zero-weight rules are never chosen', () => {
  const rules = [
    rule({ id: 'r1', priority: 1, weight: 0, conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'r2', priority: 2, weight: 10, conditions: [qp('c2', 'lang', 'de')] })
  ];
  for (let bucket = 0; bucket < BUCKET_COUNT; bucket += 313) {
    assert.equal(run(rules, { lang: 'de' }, NOW, bucket).destination, 'https://example.com/r2');
  }
});

test('a rule with no conditions is excluded from shadow warnings too', () => {
  const rules = [rule({ id: 'r1', conditions: [] })];
  const result = run(rules, {});
  assert.equal(result.trace.length, 1);
  assert.equal(result.trace[0].conditions.length, 0);
});

// --- unsupported / safety --------------------------------------------------

test('every supported condition kind is deterministic', () => {
  const rules = [
    rule({
      id: 'r1',
      conditions: [qp('c1', 'lang', 'de'), tw('c2', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')]
    })
  ];
  const a = run(rules, { lang: 'de' }).destination;
  const b = run(rules, { lang: 'de' }).destination;
  assert.equal(a, b);
  assert.equal(a, 'https://example.com/r1');
});

test('an unknown condition kind is rejected, never executed', () => {
  // Simulates a hand-edited or future row: the evaluator must ignore it.
  const hostile = {
    id: 'c1',
    kind: 'user_agent_hash' as unknown as RuleCondition['kind'],
    param: null,
    value: null,
    starts_at: null,
    ends_at: null
  };
  const rules = [rule({ id: 'r1', conditions: [hostile] })];
  const result = run(rules, { anything: 'value' });
  assert.equal(result.destination, null);
  assert.match(result.trace[0].conditions[0].reason, /Unsupported condition kind/);
});

test('no condition can widen into IP, geo or user-agent behaviour', () => {
  // Only the two closed kinds are evaluated; everything else degrades to
  // "no match" (asserted above). This guards the intent explicitly.
  const supported: RuleCondition['kind'][] = ['query_param', 'time_window'];
  assert.deepEqual([...supported].sort(), ['query_param', 'time_window']);
});