import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow } from '../lib/api/report-window';

const NOW = Date.parse('2026-03-15T12:00:00Z');

describe('analytics report windows', () => {
  it('defaults to 30 days', () => {
    const w = resolveWindow(new URLSearchParams(), NOW);
    assert.equal(w.to, '2026-03-15');
    assert.equal(w.from, '2026-02-13');
  });

  it('honours unit=week and units', () => {
    const w = resolveWindow(new URLSearchParams('unit=week&units=2'), NOW);
    assert.equal(w.from, '2026-03-01');
  });

  it('treats units=-1 as the full retained window', () => {
    const w = resolveWindow(new URLSearchParams('units=-1'), NOW);
    assert.equal(w.units, -1);
    // Bounded, not unbounded: an unbounded range over an indexed table is an
    // easy way to make an API call expensive.
    assert.equal(w.from, '2024-03-15');
  });

  it('caps a hostile units value instead of trusting it', () => {
    const w = resolveWindow(new URLSearchParams('units=99999999'), NOW);
    assert.ok(Date.parse(`${w.from}T00:00:00Z`) >= Date.parse('2024-01-01T00:00:00Z'));
  });

  it('ignores junk numbers and units', () => {
    for (const q of ['units=abc', 'units=', 'unit=fortnight&units=3', 'units=NaN']) {
      const w = resolveWindow(new URLSearchParams(q), NOW);
      assert.equal(typeof w.from, 'string');
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(w.from), `${q} should yield a date`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(w.to));
    }
  });

  it('never returns a window whose end precedes its start', () => {
    for (const q of ['', 'units=0', 'units=-5', 'units=-1', 'unit=minute&units=1']) {
      const w = resolveWindow(new URLSearchParams(q), NOW);
      assert.ok(Date.parse(w.from) <= Date.parse(w.to), `${q} inverted the window`);
    }
  });

  it('supports the documented time units', () => {
    for (const unit of ['minute', 'hour', 'day', 'week', 'month']) {
      const w = resolveWindow(new URLSearchParams(`unit=${unit}&units=1`), NOW);
      assert.ok(Date.parse(w.from) <= Date.parse(w.to));
    }
  });
});
