import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comparePeriods,
  toDailySeries,
  toBreakdown,
  sumClicks
} from '../lib/analytics/compare';

test('zero baseline with new activity avoids a fake percentage', () => {
  const result = comparePeriods(10, 0);
  assert.equal(result.kind, 'new_activity');
  assert.equal(result.percentChange, null);
  assert.match(result.description, /New activity/);
});

test('both periods empty reports no data honestly', () => {
  const result = comparePeriods(0, 0);
  assert.equal(result.kind, 'no_data');
  assert.equal(result.percentChange, null);
});

test('growth computes percentage', () => {
  const result = comparePeriods(150, 100);
  assert.equal(result.kind, 'up');
  assert.equal(result.percentChange, 50);
  assert.equal(result.delta, 50);
});

test('decline computes negative percentage', () => {
  const result = comparePeriods(50, 100);
  assert.equal(result.kind, 'down');
  assert.equal(result.percentChange, -50);
  assert.equal(result.delta, -50);
});

test('drop to zero is a full decline', () => {
  const result = comparePeriods(0, 25);
  assert.equal(result.kind, 'down');
  assert.equal(result.percentChange, -100);
});

test('equal totals are flat', () => {
  const result = comparePeriods(42, 42);
  assert.equal(result.kind, 'flat');
  assert.equal(result.percentChange, 0);
  assert.equal(result.delta, 0);
});

test('percentage is rounded to one decimal', () => {
  const result = comparePeriods(101, 100);
  assert.equal(result.percentChange, 1);
  const fractional = comparePeriods(2, 3);
  assert.equal(fractional.percentChange, -33.3);
});

test('daily series fills missing days with zero', () => {
  const series = toDailySeries(
    [{ day: '2026-03-01', click_count: 5 }],
    ['2026-02-28', '2026-03-01', '2026-03-02']
  );
  assert.deepEqual(series, [
    { day: '2026-02-28', clicks: 0 },
    { day: '2026-03-01', clicks: 5 },
    { day: '2026-03-02', clicks: 0 }
  ]);
});

test('daily series merges multiple rows on the same day', () => {
  const series = toDailySeries(
    [
      { day: '2026-03-01', click_count: '2' },
      { day: '2026-03-01', click_count: 3 }
    ],
    ['2026-03-01']
  );
  assert.deepEqual(series, [{ day: '2026-03-01', clicks: 5 }]);
});

test('daily series handles bigint-style string counts', () => {
  const series = toDailySeries([{ day: '2026-03-01', click_count: '9007199254740991' }], [
    '2026-03-01'
  ]);
  assert.equal(series[0].clicks, 9007199254740991);
});

test('breakdown aggregates referrer hosts descending', () => {
  const rows = [
    { referrer_host: 'a.com', device_category: 'desktop', click_count: 2 },
    { referrer_host: 'b.com', device_category: 'mobile', click_count: 7 },
    { referrer_host: 'a.com', device_category: 'mobile', click_count: 3 }
  ];
  assert.deepEqual(toBreakdown(rows, 'referrer_host'), [
    { key: 'b.com', clicks: 7 },
    { key: 'a.com', clicks: 5 }
  ]);
});

test('breakdown ties break deterministically by key', () => {
  const rows = [
    { referrer_host: 'z.com', device_category: 'desktop', click_count: 4 },
    { referrer_host: 'a.com', device_category: 'desktop', click_count: 4 }
  ];
  assert.deepEqual(toBreakdown(rows, 'referrer_host'), [
    { key: 'a.com', clicks: 4 },
    { key: 'z.com', clicks: 4 }
  ]);
});

test('device breakdown aggregates categories', () => {
  const rows = [
    { referrer_host: 'a.com', device_category: 'mobile', click_count: 1 },
    { referrer_host: 'b.com', device_category: 'mobile', click_count: 2 },
    { referrer_host: 'c.com', device_category: 'bot', click_count: 9 }
  ];
  assert.deepEqual(toBreakdown(rows, 'device_category'), [
    { key: 'bot', clicks: 9 },
    { key: 'mobile', clicks: 3 }
  ]);
});

test('sumClicks totals rows', () => {
  assert.equal(sumClicks([{ click_count: 1 }, { click_count: '4' }]), 5);
  assert.equal(sumClicks([]), 0);
});