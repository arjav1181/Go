import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDeviceCategory, parseReferrerHost } from '../lib/analytics/device-category';

test('detects mobile', () => {
  assert.equal(deriveDeviceCategory('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'), 'mobile');
});

test('detects bot', () => {
  assert.equal(deriveDeviceCategory('Googlebot/2.1'), 'bot');
});

test('defaults desktop', () => {
  assert.equal(deriveDeviceCategory('Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/120'), 'desktop');
});

test('unknown on null', () => {
  assert.equal(deriveDeviceCategory(null), 'unknown');
});

test('parses referrer host', () => {
  assert.equal(parseReferrerHost('https://example.com/path?q=1'), 'example.com');
});

test('direct on missing', () => {
  assert.equal(parseReferrerHost(null), 'direct');
});
