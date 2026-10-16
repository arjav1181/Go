import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashLinkPassword,
  verifyLinkPassword,
  linkPasswordFingerprint,
  validateLinkPassword
} from '../lib/links/passwords';
import {
  normalizeCampaign,
  campaignFromUrl,
  withCampaignParam,
  rollupCampaigns,
  CAMPAIGN_PATTERN
} from '../lib/links/campaigns';

// --- passwords -------------------------------------------------------------

test('a correct password verifies', () => {
  const stored = hashLinkPassword('correct horse 9');
  assert.equal(verifyLinkPassword(stored, 'correct horse 9'), true);
});

test('a wrong password is refused', () => {
  const stored = hashLinkPassword('correct horse 9');
  assert.equal(verifyLinkPassword(stored, 'wrong horse 9'), false);
  assert.equal(verifyLinkPassword(stored, ''), false);
  assert.equal(verifyLinkPassword(stored, 'CORRECT HORSE 9'), false);
});

test('the plaintext is never recoverable from the hash', () => {
  const stored = hashLinkPassword('hunter2secret');
  assert.ok(!stored.includes('hunter2secret'));
  assert.match(stored, /^scrypt\$/);
});

test('the same password hashes differently every time', () => {
  // A per-hash salt means two links with the same password must not be
  // identifiable as such from a database dump.
  assert.notEqual(hashLinkPassword('same-password-1'), hashLinkPassword('same-password-1'));
});

test('an absent or malformed hash refuses rather than throwing', () => {
  for (const bad of [null, undefined, '', 'nonsense', 'scrypt$only', 'scrypt$$', 'bcrypt$a$b$c']) {
    assert.equal(verifyLinkPassword(bad, 'anything'), false, String(bad));
  }
});

test('the fingerprint reveals protection state but not the password', () => {
  const stored = hashLinkPassword('abc123xyz');
  const fp = linkPasswordFingerprint(stored);
  assert.ok(fp && fp.length === 12);
  assert.equal(linkPasswordFingerprint(null), null);
  // Stable for the same stored value, so the UI badge does not flicker.
  assert.equal(linkPasswordFingerprint(stored), fp);
  assert.ok(!('abc123xyz'.length > 0 && fp.includes('abc123xyz')));
});

test('password policy rejects weak secrets and accepts reasonable ones', () => {
  assert.equal(validateLinkPassword('short').ok, false);
  assert.equal(validateLinkPassword('alllowercase').ok, false, 'one character class is too weak');
  assert.equal(validateLinkPassword('      ').ok, false);
  assert.equal(validateLinkPassword('x'.repeat(200)).ok, false);
  assert.equal(validateLinkPassword('abcdefgh').ok, false, 'one character class, however long');
  assert.equal(validateLinkPassword('Passw0rd!').ok, true);
  assert.equal(validateLinkPassword('a'.repeat(64)).ok, false, 'length does not buy character classes');
  assert.equal(validateLinkPassword('abcdefgh1').ok, true, 'letters plus a digit is two classes');
});

// --- campaigns -------------------------------------------------------------

test('campaign names normalise to a safe shape', () => {
  // Spaces inside a name are invalid by design: `normalizeCampaign` trims the
  // edges but does not collapse interior whitespace, so "Spring Launch" fails
  // rather than silently becoming "spring launch".
  const kept = normalizeCampaign('spring-launch_2');
  assert.equal(kept.ok, true);
  assert.equal(kept.ok && kept.campaign, 'spring-launch_2');

  const padded = normalizeCampaign('  spring  ');
  assert.equal(padded.ok, true);
  assert.equal(padded.ok && padded.campaign, 'spring');
  assert.equal(normalizeCampaign('Spring Launch').ok, false);
});

test('an empty campaign clears rather than errors', () => {
  for (const empty of ['', '   ', null, undefined]) {
    assert.deepEqual(normalizeCampaign(empty), { ok: true, campaign: null });
  }
});

test('unsafe campaign names are rejected', () => {
  for (const bad of ['a b', 'x'.repeat(40), 'drop; table', '../etc', 'tag\nnewline', 'a,b']) {
    const result = normalizeCampaign(bad);
    assert.equal(result.ok, false, bad);
  }
  // Plain letters are a perfectly good campaign name; the pattern is about
  // shape, not about English words.
  assert.equal(normalizeCampaign('newsletter').ok, true);
});

test('a campaign from the query string is only read when it matches exactly', () => {
  assert.equal(campaignFromUrl('https://x.example/p?c=spring'), 'spring');
  // Anything off-pattern is discarded, not trimmed or escaped.
  assert.equal(campaignFromUrl('https://x.example/p?c=%3Cscript%3E'), null);
  assert.equal(campaignFromUrl('https://x.example/p?c= spring'), null);
  assert.equal(campaignFromUrl('https://x.example/p?c=spring%20'), null);
  assert.equal(campaignFromUrl('https://x.example/p'), null);
  assert.equal(campaignFromUrl('not a url'), null);
});

test('the campaign pattern is genuinely restrictive', () => {
  assert.ok(CAMPAIGN_PATTERN.test('a'));
  assert.ok(CAMPAIGN_PATTERN.test('spring-2026_q3'));
  assert.ok(!CAMPAIGN_PATTERN.test(''));
  assert.ok(!CAMPAIGN_PATTERN.test('a'.repeat(33)));
  assert.ok(!CAMPAIGN_PATTERN.test('Spring'));
  assert.ok(!CAMPAIGN_PATTERN.test('a b'));
});

test('appending a campaign preserves an existing destination query', () => {
  const out = withCampaignParam('https://x.example/p?id=7', 'spring');
  const url = new URL(out);
  assert.equal(url.searchParams.get('id'), '7');
  assert.equal(url.searchParams.get('c'), 'spring');
});

test('an invalid campaign leaves the destination untouched', () => {
  assert.equal(withCampaignParam('https://x.example/p', 'bad value'), 'https://x.example/p');
  assert.equal(withCampaignParam('not a url', 'spring'), 'not a url');
});

test('campaign rollup sorts by clicks and groups untagged', () => {
  const rollups = rollupCampaigns([
    { campaign: 'spring', clicks: 10 },
    { campaign: 'summer', clicks: 30 },
    { campaign: '', clicks: 10 }
  ]);
  assert.equal(rollups[0].campaign, 'summer');
  assert.equal(rollups[0].share, 0.6);
  assert.ok(rollups.some((r) => r.campaign === 'untagged'));
  assert.equal(
    rollups.reduce((s, r) => s + r.clicks, 0),
    50
  );
});

test('a rollup of all-zero clicks does not divide by zero', () => {
  const rollups = rollupCampaigns([
    { campaign: 'a', clicks: 0 },
    { campaign: 'b', clicks: 0 }
  ]);
  for (const row of rollups) assert.equal(row.share, 0);
});
// --- bio pages -------------------------------------------------------------

import {
  validateHandle,
  normalizeHandle,
  isReservedHandle,
  safeBioHref,
  safeAccentColor
} from '../lib/links/bio-rules';

test('bio handles normalise and validate', () => {
  assert.equal(validateHandle('  Arjav  ').ok && validateHandle('  Arjav  ').ok && (validateHandle('  Arjav  ') as { handle: string }).handle, 'arjav');
  assert.equal(validateHandle('arjav').ok, true);
  assert.equal(validateHandle('a-b_c9').ok, true);
  assert.equal(validateHandle('ab').ok, false, 'too short');
  assert.equal(validateHandle('x'.repeat(40)).ok, false, 'too long');
  assert.equal(validateHandle('').ok, false);
  assert.equal(validateHandle('has space').ok, false);
});

test('a bio handle cannot shadow an application route', () => {
  for (const reserved of ['api', 'login', 'dashboard', 'settings', 'privacy', 'terms', 'docs', 'tags', 'links']) {
    assert.equal(isReservedHandle(reserved), true, reserved);
    assert.equal(validateHandle(reserved).ok, false, reserved);
  }
});

test('handle normalisation is deterministic', () => {
  assert.equal(normalizeHandle('  ARJAV  '), 'arjav');
});

test('bio hrefs only ever allow http and https', () => {
  assert.equal(safeBioHref('https://example.com/x'), 'https://example.com/x');
  assert.equal(safeBioHref('http://example.com/x'), 'http://example.com/x');
  // A public page must never render a javascript: href.
  assert.equal(safeBioHref('javascript:alert(1)'), null);
  assert.equal(safeBioHref('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeBioHref('not a url'), null);
});

test('an accent colour outside a hex triple is rejected', () => {
  assert.equal(safeAccentColor('#0070f3'), '#0070f3');
  // Prevents a style-injection vector through the inline accent.
  assert.equal(safeAccentColor('red; background: url(javascript:1)'), '#0070f3');
  assert.equal(safeAccentColor('rgb(1,2,3)'), '#0070f3');
  assert.equal(safeAccentColor('#fff'), '#0070f3');
});
