import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDeviceCategory, parseReferrerHost } from '../lib/analytics/device-category';

test('referrer stores hostname only, never full url or query', () => {
  const host = parseReferrerHost('https://mail.example.com/inbox?token=secret#frag');
  assert.equal(host, 'mail.example.com');
  assert.equal(host.includes('/'), false);
  assert.equal(host.includes('?'), false);
  assert.equal(host.includes('token'), false);
});

test('invalid referrer becomes unknown', () => {
  assert.equal(parseReferrerHost('not a url'), 'unknown');
});

test('missing referrer becomes direct', () => {
  assert.equal(parseReferrerHost(null), 'direct');
  assert.equal(parseReferrerHost(''), 'direct');
});

test('device category is a coarse label only', () => {
  const allowed = new Set(['mobile', 'desktop', 'tablet', 'bot', 'unknown']);
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  assert.equal(allowed.has(deriveDeviceCategory(ua)), true);
  assert.equal(deriveDeviceCategory(ua).includes('Mozilla'), false);
});
