import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRule, validateRuleSet, hasBlockingIssues } from '../lib/rules/validate';
import type { Rule, RuleCondition } from '../lib/rules/evaluate';

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
  destination_url: 'https://example.com/x',
  weight: 100,
  is_active: true,
  conditions: [],
  ...partial
});

const codes = (issues: ReturnType<typeof validateRule>) => issues.map((i) => i.code);

test('a well-formed rule produces no errors', () => {
  const issues = validateRule(rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de')] }));
  assert.equal(hasBlockingIssues(issues), false, JSON.stringify(issues));
});

test('a rule with no conditions is rejected', () => {
  const issues = validateRule(rule({ id: 'r1', conditions: [] }));
  assert.ok(codes(issues).includes('no_conditions'));
  assert.equal(hasBlockingIssues(issues), true);
});

test('a missing destination is rejected', () => {
  const issues = validateRule(
    rule({ id: 'r1', destination_url: '  ', conditions: [qp('c1', 'a', 'b')] })
  );
  assert.ok(codes(issues).includes('destination_missing'));
});

test('non-integer or non-positive priority is rejected', () => {
  assert.ok(codes(validateRule(rule({ id: 'r1', priority: 0, conditions: [qp('c', 'a', 'b')] }))).includes('priority_invalid'));
  assert.ok(codes(validateRule(rule({ id: 'r1', priority: 1.5, conditions: [qp('c', 'a', 'b')] }))).includes('priority_invalid'));
});

test('out-of-range weights are rejected', () => {
  const base = [qp('c', 'a', 'b')];
  assert.ok(codes(validateRule(rule({ id: 'r1', weight: -1, conditions: base }))).includes('weight_invalid'));
  assert.ok(codes(validateRule(rule({ id: 'r1', weight: 101, conditions: base }))).includes('weight_invalid'));
  assert.ok(codes(validateRule(rule({ id: 'r1', weight: NaN, conditions: base }))).includes('weight_invalid'));
});

test('an invalid parameter name is rejected', () => {
  const issues = validateRule(rule({ id: 'r1', conditions: [qp('c1', 'bad name', 'x')] }));
  assert.ok(codes(issues).includes('param_invalid'));
});

test('a query condition with no values is rejected', () => {
  const issues = validateRule(rule({ id: 'r1', conditions: [qp('c1', 'lang', '')] }));
  assert.ok(codes(issues).includes('values_missing'));
});

test('repeating the same parameter is a warning, not an error', () => {
  const issues = validateRule(
    rule({ id: 'r1', conditions: [qp('c1', 'lang', 'de'), qp('c2', 'LANG', 'fr')] })
  );
  assert.ok(codes(issues).includes('param_repeated'));
  assert.equal(hasBlockingIssues(issues), false);
});

test('an invalid or inverted time window is rejected', () => {
  const badStart = validateRule(
    rule({ id: 'r1', conditions: [tw('c1', 'nope', 'also-nope')] })
  );
  assert.ok(codes(badStart).includes('start_invalid'));

  const inverted = validateRule(
    rule({ id: 'r1', conditions: [tw('c1', '2026-09-02T00:00:00Z', '2026-08-01T00:00:00Z')] })
  );
  assert.ok(codes(inverted).includes('window_inverted'));
});

test('an unsupported condition kind is rejected', () => {
  const hostile = {
    id: 'c1',
    kind: 'geoip' as unknown as RuleCondition['kind'],
    param: null,
    value: null,
    starts_at: null,
    ends_at: null
  };
  const issues = validateRule(rule({ id: 'r1', conditions: [hostile] }));
  assert.ok(codes(issues).includes('kind_unsupported'));
});

// --- set-level -------------------------------------------------------------

test('duplicate priorities produce a warning', () => {
  const rules = [
    rule({ id: 'r1', priority: 1, conditions: [qp('c1', 'a', '1')] }),
    rule({ id: 'r2', priority: 1, conditions: [qp('c2', 'b', '2')] })
  ];
  const issues = validateRuleSet(rules);
  assert.ok(issues.some((i) => i.code === 'priority_tie'));
  assert.equal(hasBlockingIssues(issues), false);
});

test('rules with identical conditions are flagged as ambiguous', () => {
  const rules = [
    rule({ id: 'r1', priority: 1, conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'r2', priority: 2, conditions: [qp('c2', 'lang', 'de')] })
  ];
  const issues = validateRuleSet(rules);
  assert.ok(issues.filter((i) => i.code === 'duplicate_conditions').length >= 2);
});

test('different conditions are not flagged as duplicates', () => {
  const rules = [
    rule({ id: 'r1', priority: 1, conditions: [qp('c1', 'lang', 'de')] }),
    rule({ id: 'r2', priority: 2, conditions: [qp('c2', 'lang', 'fr')] })
  ];
  assert.equal(validateRuleSet(rules).some((i) => i.code === 'duplicate_conditions'), false);
});

test('an empty rule set is valid', () => {
  assert.deepEqual(validateRuleSet([]), []);
  assert.equal(hasBlockingIssues(validateRuleSet([])), false);
});

test('error severity blocks, warning severity does not', () => {
  const issues = validateRuleSet([rule({ id: 'r1', conditions: [] })]);
  assert.ok(issues.some((i) => i.severity === 'error'));
  assert.equal(hasBlockingIssues(issues), true);

  const warningsOnly = validateRuleSet([
    rule({ id: 'r1', priority: 1, conditions: [qp('c1', 'a', '1')] }),
    rule({ id: 'r2', priority: 1, conditions: [qp('c2', 'b', '2')] })
  ]);
  assert.equal(hasBlockingIssues(warningsOnly), false);
});