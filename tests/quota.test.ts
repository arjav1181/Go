import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkQuota,
  clampHistoryDays,
  limitsFor,
  isPlanName,
  windowStart,
  PLAN_DEFAULTS,
  PLAN_NAMES,
  QUOTA_ACTIONS,
  QUOTA_WINDOW_DAYS
} from '../lib/tenancy/quota';

describe('plans and quotas', () => {
  it('leaves the default plan unmetered', () => {
    // One operator, no paywall anyone asked for. Adding a paid tier must not
    // require touching this.
    for (const action of QUOTA_ACTIONS) {
      assert.equal(limitsFor('solo')[action], null, action);
      assert.equal(checkQuota('solo', action, 1_000_000).allowed, true);
    }
  });

  it('enforces a configured ceiling', () => {
    const limit = limitsFor('team').link_create;
    assert.ok(limit !== null);
    assert.equal(checkQuota('team', 'link_create', (limit ?? 0) - 1).allowed, true);
    assert.equal(checkQuota('team', 'link_create', limit ?? 0).allowed, false);
    assert.match(checkQuota('team', 'link_create', limit ?? 0).reason ?? '', /link create/);
  });

  it('never reports negative remaining', () => {
    const d = checkQuota('team', 'link_create', 10_000);
    assert.equal(d.remaining, 0);
    assert.equal(d.allowed, false);
  });

  it('separates creation quota from traffic allowance', () => {
    // The spec is explicit that creation ceilings do not cap clicks, and that
    // destination changes are metered independently of creation.
    assert.notEqual(limitsFor('team').link_create, limitsFor('team').link_redirect);
    assert.equal(limitsFor('enterprise').link_create, null);
    assert.equal(limitsFor('enterprise').link_redirect, null);
  });

  it('does not lock an owner out on an unknown plan name', () => {
    // An unrecognised plan must fall back rather than reject.
    assert.equal(isPlanName('solo'), true);
    assert.equal(isPlanName('platinum'), false);
    assert.equal(limitsFor('platinum' as never).link_create, null);
  });

  it('clamps analytics history rather than deleting rows', () => {
    assert.equal(clampHistoryDays('solo', 30), 30);
    assert.equal(clampHistoryDays('team', 365), limitsFor('team').analyticsHistoryDays);
    assert.equal(clampHistoryDays('team', 5), 5);
    assert.ok(clampHistoryDays('business', 10_000) <= 365);
    assert.ok(clampHistoryDays('solo', 0) >= 1, 'never returns a zero-width window');
  });

  it('windows every counter monthly', () => {
    assert.equal(QUOTA_WINDOW_DAYS, 30);
    const start = windowStart(new Date('2026-03-15T00:00:00Z'));
    assert.equal(start, '2026-02-13');
  });

  it('every plan declares every action', () => {
    for (const plan of PLAN_NAMES) {
      const limits = PLAN_DEFAULTS[plan];
      for (const action of QUOTA_ACTIONS) {
        assert.ok(limits[action] === null || typeof limits[action] === 'number', `${plan}.${action}`);
      }
    }
  });
});
