import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRedirectTarget,
  assignmentKey,
  experimentSalt,
  type ExperimentVariant,
  type ResolutionInput
} from '../lib/links/resolve-target';
import type { ScheduleWindow } from '../lib/links/target';
import type { Rule } from '../lib/rules/evaluate';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOUR = 3_600_000;

const base = (over: Partial<ResolutionInput> = {}): ResolutionInput => ({
  linkId: 'link-1',
  linkDestination: 'https://example.com/base',
  domain: '',
  schedules: [],
  variants: [],
  rules: [],
  query: {},
  now: NOW,
  salt: 'test-salt',
  ...over
});

const sched = (id: string, startH: number, endH: number | null): ScheduleWindow => ({
  id,
  destination_url: `https://example.com/${id}`,
  starts_at: new Date(NOW.getTime() + startH * HOUR).toISOString(),
  ends_at: endH === null ? null : new Date(NOW.getTime() + endH * HOUR).toISOString()
});

const variant = (label: string, weight: number, extra: Partial<ExperimentVariant> = {}): ExperimentVariant => ({
  id: label,
  label,
  weight,
  is_active: true,
  destination_url: `https://example.com/${label}`,
  experiment_id: 'exp-1',
  ...extra
});

const rule = (partial: Partial<Rule> & { id: string }): Rule => ({
  name: `rule-${partial.id}`,
  priority: 1,
  destination_url: `https://example.com/${partial.id}`,
  weight: 100,
  is_active: true,
  conditions: [
    { id: 'c1', kind: 'query_param', param: 'lang', value: 'de', starts_at: null, ends_at: null }
  ],
  ...partial
});

test('plain link resolves to its own destination', () => {
  const result = resolveRedirectTarget(base());
  assert.equal(result.source, 'link');
  assert.equal(result.destination, 'https://example.com/base');
});

test('an active schedule beats everything below it', () => {
  const result = resolveRedirectTarget(
    base({
      schedules: [sched('promo', -1, 5)],
      variants: [variant('a', 100)],
      rules: [rule({ id: 'r1' })],
      query: { lang: 'de' }
    })
  );
  assert.equal(result.source, 'schedule');
  assert.equal(result.destination, 'https://example.com/promo');
});

test('an inactive schedule does not apply', () => {
  const result = resolveRedirectTarget(base({ schedules: [sched('promo', 5, 9)] }));
  assert.equal(result.source, 'link');
});

test('a matching rule beats variants', () => {
  const result = resolveRedirectTarget(
    base({
      rules: [rule({ id: 'r1' })],
      variants: [variant('a', 100)],
      query: { lang: 'de' }
    })
  );
  assert.equal(result.source, 'rule');
  assert.equal(result.destination, 'https://example.com/r1');
});

test('a non-matching rule falls through to variants', () => {
  const result = resolveRedirectTarget(
    base({
      rules: [rule({ id: 'r1' })],
      variants: [variant('a', 100)],
      query: { lang: 'fr' }
    })
  );
  assert.equal(result.source, 'variant');
});

test('a rule decision is returned for the explanation view', () => {
  const result = resolveRedirectTarget(
    base({ rules: [rule({ id: 'r1' })], query: { lang: 'de' } })
  );
  assert.ok(result.ruleDecision);
  assert.equal(result.ruleDecision?.rule?.id, 'r1');
  assert.equal(result.ruleDecision?.trace.length, 1);
});

test('no rules means no rule decision', () => {
  assert.equal(resolveRedirectTarget(base()).ruleDecision, null);
});

test('variants split traffic deterministically for the same key', () => {
  const input = base({ variants: [variant('a', 50), variant('b', 50)] });
  const first = resolveRedirectTarget(input).destination;
  for (let i = 0; i < 50; i += 1) {
    assert.equal(resolveRedirectTarget(input).destination, first);
  }
});

test('the served variant is reported for click grouping', () => {
  const result = resolveRedirectTarget(base({ variants: [variant('a', 100)] }));
  assert.equal(result.source, 'variant');
  assert.equal(result.variantLabel, 'a');
  assert.equal(result.experimentId, 'exp-1');
});

test('link source reports an empty variant label', () => {
  const result = resolveRedirectTarget(base());
  assert.equal(result.variantLabel, '');
  assert.equal(result.experimentId, null);
});

test('an unsafe variant destination falls back to the link destination', () => {
  const result = resolveRedirectTarget(
    base({
      linkDestination: 'https://example.com/base',
      variants: [variant('bad', 100, { destination_url: 'javascript:alert(1)' })]
    })
  );
  assert.equal(result.destination, 'https://example.com/base');
});

test('an unsafe schedule destination falls back safely', () => {
  const result = resolveRedirectTarget(
    base({
      schedules: [
        { id: 'bad', destination_url: 'data:text/html,x', starts_at: '2020-01-01T00:00:00Z', ends_at: null }
      ]
    })
  );
  assert.equal(result.destination, 'https://example.com/base');
});

test('an unsafe rule destination falls back safely', () => {
  const result = resolveRedirectTarget(
    base({
      rules: [rule({ id: 'r1', destination_url: 'file:///etc/passwd' })],
      query: { lang: 'de' }
    })
  );
  assert.equal(result.destination, 'https://example.com/base');
});

test('a rule with no conditions never hijacks the request', () => {
  const result = resolveRedirectTarget(
    base({ rules: [rule({ id: 'r1', conditions: [] })], query: {} })
  );
  assert.equal(result.source, 'link');
});

test('tracking parameters never drive a rule', () => {
  const result = resolveRedirectTarget(
    base({ rules: [rule({ id: 'r1' })], query: { utm_source: 'de' } })
  );
  assert.equal(result.source, 'link');
});

test('all-zero-weight variants fall back to the link', () => {
  const result = resolveRedirectTarget(base({ variants: [variant('a', 0)] }));
  assert.equal(result.source, 'link');
});

test('salt changes the bucketing key', () => {
  assert.notEqual(assignmentKey('l1', '', 'salt-a'), assignmentKey('l1', '', 'salt-b'));
  assert.equal(assignmentKey('l1', '', 'salt-a'), assignmentKey('l1', '', 'salt-a'));
});

test('domain participates in the assignment key', () => {
  assert.notEqual(assignmentKey('l1', 'a.example', 's'), assignmentKey('l1', 'b.example', 's'));
});

test('experimentSalt reads configuration and defaults to empty', () => {
  const previous = process.env.EXPERIMENT_SALT;
  delete process.env.EXPERIMENT_SALT;
  assert.equal(experimentSalt(), '');
  process.env.EXPERIMENT_SALT = 'abc';
  assert.equal(experimentSalt(), 'abc');
  if (previous === undefined) delete process.env.EXPERIMENT_SALT;
  else process.env.EXPERIMENT_SALT = previous;
});

test('resolution is stable for the same salt', () => {
  const input = base({ variants: [variant('a', 50), variant('b', 50)] });
  const a = resolveRedirectTarget(input).variantLabel;
  const b = resolveRedirectTarget({ ...input }).variantLabel;
  assert.equal(a, b);
});