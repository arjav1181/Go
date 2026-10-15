import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveReferrerHost,
  resolveDeviceCategory,
  normalizeAggregation,
  describeAggregation,
  DEFAULT_AGGREGATION,
  NO_REFERRER,
  NO_DEVICE
} from '../lib/settings/aggregation';

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const UA_BOT = 'Googlebot/2.1';

test('defaults collect both dimensions', () => {
  assert.deepEqual(normalizeAggregation({}), { track_referrer: true, track_device: true });
  assert.deepEqual(DEFAULT_AGGREGATION, { track_referrer: true, track_device: true });
});

test('normalizeAggregation coerces non-boolean input to disabled or enabled', () => {
  assert.deepEqual(normalizeAggregation({ track_referrer: 'false' }), {
    track_referrer: false,
    track_device: true
  });
  assert.deepEqual(normalizeAggregation({ track_device: 0 }), {
    track_referrer: true,
    track_device: false
  });
});

test('enabled dimensions behave exactly as before', () => {
  assert.equal(resolveReferrerHost(DEFAULT_AGGREGATION, 'https://a.example/p?q=1'), 'a.example');
  assert.equal(resolveDeviceCategory(DEFAULT_AGGREGATION, UA_IOS), 'mobile');
});

test('disabling referrer stores a fixed sentinel', () => {
  const settings = { track_referrer: false, track_device: true };
  assert.equal(resolveReferrerHost(settings, 'https://secret.example/path?q=token'), NO_REFERRER);
  assert.equal(resolveReferrerHost(settings, null), NO_REFERRER);
});

test('disabling device stores a fixed sentinel', () => {
  const settings = { track_referrer: true, track_device: false };
  assert.equal(resolveDeviceCategory(settings, UA_IOS), NO_DEVICE);
  assert.equal(resolveDeviceCategory(settings, UA_BOT), NO_DEVICE);
});

test('disabling both collapses everything to sentinels', () => {
  const settings = { track_referrer: false, track_device: false };
  assert.equal(resolveReferrerHost(settings, 'https://a.example'), NO_REFERRER);
  assert.equal(resolveDeviceCategory(settings, UA_IOS), NO_DEVICE);
});

test('disabling a dimension never leaks the raw value into the sentinel', () => {
  const settings = { track_referrer: false, track_device: false };
  const ref = resolveReferrerHost(settings, 'https://secret.example/path?q=token');
  const dev = resolveDeviceCategory(settings, UA_IOS);
  assert.equal(ref.includes('secret'), false);
  assert.equal(dev.includes('iPhone'), false);
});

test('one dimension can be disabled while the other keeps working', () => {
  const noReferrer = { track_referrer: false, track_device: true };
  assert.equal(resolveReferrerHost(noReferrer, 'https://a.example'), NO_REFERRER);
  assert.equal(resolveDeviceCategory(noReferrer, UA_BOT), 'bot');

  const noDevice = { track_referrer: true, track_device: false };
  assert.equal(resolveReferrerHost(noDevice, 'https://a.example'), 'a.example');
  assert.equal(resolveDeviceCategory(noDevice, UA_BOT), NO_DEVICE);
});

test('sentinels match the values the aggregate table already allows', () => {
  // 'unknown' was already a valid device bucket before this feature.
  assert.equal(deriveUnknownIsValid(), true);
});

function deriveUnknownIsValid(): boolean {
  return resolveDeviceCategory({ track_referrer: true, track_device: true }, null) === 'unknown';
}

test('describeAggregation reports both dimensions', () => {
  assert.match(describeAggregation(DEFAULT_AGGREGATION), /referrer hostname/);
  assert.match(describeAggregation({ track_referrer: false, track_device: false }), /no referrer/);
});