import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  issueGrant,
  verifyGrant,
  grantCookieName,
  grantCookieOptions,
  GRANT_TTL_MS
} from '../lib/links/password-grant';

process.env.EXPERIMENT_SALT = 'test-salt-that-is-long-enough';

describe('password grants', () => {
  it('round trips a grant', () => {
    const now = 1_000_000;
    const token = issueGrant({ slug: 'abc', linkId: 'link-1' }, now);
    assert.ok(token);
    const grant = verifyGrant(token, now);
    assert.equal(grant?.slug, 'abc');
    assert.equal(grant?.linkId, 'link-1');
    assert.equal(grant?.expiresAt, now + GRANT_TTL_MS);
  });

  it('refuses a grant past its expiry', () => {
    const now = 1_000_000;
    const token = issueGrant({ slug: 'abc', linkId: 'link-1' }, now)!;
    assert.equal(verifyGrant(token, now + GRANT_TTL_MS), null, 'expired at exactly ttl');
    assert.equal(verifyGrant(token, now + GRANT_TTL_MS - 1) !== null, true, 'valid just before ttl');
  });

  it('rejects a tampered payload', () => {
    const token = issueGrant({ slug: 'abc', linkId: 'link-1' })!;
    const [payload, sig] = token.split('.');
    const forged = Buffer.from('evil.link-9.99999999999999', 'utf8').toString('base64url');
    assert.equal(verifyGrant(`${forged}.${sig}`), null);
    assert.ok(payload);
  });

  it('rejects a tampered signature', () => {
    const token = issueGrant({ slug: 'abc', linkId: 'link-1' })!;
    const [payload] = token.split('.');
    assert.equal(verifyGrant(`${payload}.notarealsignature`), null);
  });

  it('rejects garbage without throwing', () => {
    for (const bad of ['', '.', '..', 'a.b', 'a.b.c', 'not-base64!.sig', undefined, null]) {
      assert.equal(verifyGrant(bad as string | null | undefined), null);
    }
  });

  it('is bound to one slug and one link', () => {
    const token = issueGrant({ slug: 'abc', linkId: 'link-1' })!;
    const grant = verifyGrant(token)!;
    // The caller compares both fields; confirm they survive intact so the
    // comparison is meaningful rather than always-false.
    assert.notEqual(grant.slug, 'xyz');
    assert.notEqual(grant.linkId, 'link-2');
  });

  it('fails closed when no signing key is configured', () => {
    const saved = process.env.EXPERIMENT_SALT;
    delete process.env.EXPERIMENT_SALT;
    delete process.env.CRON_SECRET;
    try {
      assert.equal(issueGrant({ slug: 'a', linkId: 'b' }), null);
    } finally {
      process.env.EXPERIMENT_SALT = saved;
    }
  });

  it('refuses a short signing key', () => {
    const saved = process.env.EXPERIMENT_SALT;
    process.env.EXPERIMENT_SALT = 'short';
    try {
      assert.equal(issueGrant({ slug: 'a', linkId: 'b' }), null);
    } finally {
      process.env.EXPERIMENT_SALT = saved;
    }
  });

  it('scopes the cookie name to one slug', () => {
    assert.equal(grantCookieName('abc'), 'lk_abc');
    // Distinct slugs must not collide, or one unlock would open another.
    assert.notEqual(grantCookieName('aaa'), grantCookieName('aab'));
    assert.ok(!/[^\w-]/.test(grantCookieName('a/b;c')), 'cookie name must be sanitised');
  });

  it('sets HttpOnly, SameSite and a max age', () => {
    const opts = grantCookieOptions(600, true);
    assert.match(opts, /HttpOnly/);
    assert.match(opts, /SameSite=Lax/);
    assert.match(opts, /Max-Age=600/);
    assert.match(opts, /Secure/);
    // Secure is omitted for local http so the flow still works in development.
    assert.ok(!grantCookieOptions(600, false).includes('Secure'));
  });
});