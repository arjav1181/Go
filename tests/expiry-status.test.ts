import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getExpiryInfo,
  isRedirectEligible,
  formatRemaining,
  EXPIRING_SOON_DAYS
} from '../lib/links/status';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const DAY = 86_400_000;

test('no expiry and active is active', () => {
  const info = getExpiryInfo({ is_active: true, expires_at: null }, NOW);
  assert.equal(info.status, 'active');
  assert.equal(info.remainingMs, null);
});

test('no expiry but inactive is disabled', () => {
  const info = getExpiryInfo({ is_active: false, expires_at: null }, NOW);
  assert.equal(info.status, 'disabled');
});

test('expiry far in the future is active', () => {
  const info = getExpiryInfo(
    { is_active: true, expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString() },
    NOW
  );
  assert.equal(info.status, 'active');
  assert.equal(info.remainingMs, 30 * DAY);
});

test('expiry within the soon window is expiring_soon', () => {
  const info = getExpiryInfo(
    { is_active: true, expires_at: new Date(NOW.getTime() + 2 * DAY).toISOString() },
    NOW
  );
  assert.equal(info.status, 'expiring_soon');
  assert.equal(info.expired, false);
});

test('exactly at the soon boundary counts as expiring_soon', () => {
  const info = getExpiryInfo(
    { is_active: true, expires_at: new Date(NOW.getTime() + EXPIRING_SOON_DAYS * DAY).toISOString() },
    NOW
  );
  assert.equal(info.status, 'expiring_soon');
});

test('one millisecond past the soon boundary is active', () => {
  const info = getExpiryInfo(
    {
      is_active: true,
      expires_at: new Date(NOW.getTime() + EXPIRING_SOON_DAYS * DAY + 1).toISOString()
    },
    NOW
  );
  assert.equal(info.status, 'active');
});

test('past expiry is expired', () => {
  const info = getExpiryInfo(
    { is_active: true, expires_at: new Date(NOW.getTime() - 1).toISOString() },
    NOW
  );
  assert.equal(info.status, 'expired');
  assert.equal(info.expired, true);
});

test('expiry exactly now is expired (boundary is exclusive of active)', () => {
  const info = getExpiryInfo({ is_active: true, expires_at: NOW.toISOString() }, NOW);
  assert.equal(info.status, 'expired');
  assert.equal(info.remainingMs, 0);
});

test('disabled wins over expired for display', () => {
  const info = getExpiryInfo(
    { is_active: false, expires_at: new Date(NOW.getTime() - 5 * DAY).toISOString() },
    NOW
  );
  assert.equal(info.status, 'disabled');
  assert.equal(info.expired, true);
});

test('timezone offsets do not change the outcome', () => {
  // Same instant expressed with different offsets.
  const utc = '2026-03-01T12:00:00.000Z';
  const offset = '2026-03-01T14:00:00.000+02:00';
  const a = getExpiryInfo({ is_active: true, expires_at: utc }, NOW);
  const b = getExpiryInfo({ is_active: true, expires_at: offset }, NOW);
  assert.equal(a.status, b.status);
  assert.equal(a.remainingMs, b.remainingMs);
});

test('redirect eligibility mirrors status', () => {
  assert.equal(isRedirectEligible({ is_active: true, expires_at: null }, NOW), true);
  assert.equal(
    isRedirectEligible(
      { is_active: true, expires_at: new Date(NOW.getTime() + DAY).toISOString() },
      NOW
    ),
    true
  );
  assert.equal(
    isRedirectEligible(
      { is_active: true, expires_at: new Date(NOW.getTime() - DAY).toISOString() },
      NOW
    ),
    false
  );
  assert.equal(isRedirectEligible({ is_active: false, expires_at: null }, NOW), false);
});

test('formatRemaining renders coarse units', () => {
  assert.equal(formatRemaining(3 * DAY + 4 * 3_600_000), '3d 4h');
  assert.equal(formatRemaining(2 * 3_600_000 + 15 * 60_000), '2h 15m');
  assert.equal(formatRemaining(45 * 60_000), '45m');
});

test('formatRemaining marks past durations as expired', () => {
  assert.equal(formatRemaining(-2 * DAY), 'expired 2d 0h ago');
});