import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDomainHostname,
  isPlausibleHostname,
  verifyTxtRecord,
  generateVerificationToken,
  dnsInstructions,
  rootRouterActive,
  MAX_DOMAIN_LENGTH,
  VERIFICATION_HOST
} from '../lib/domains/verification';

describe('domain hostname validation', () => {
  it('accepts a normal short domain', () => {
    assert.equal(validateDomainHostname('sh.example.com').ok, true);
    assert.equal(validateDomainHostname('  SH.Example.com ').ok, true, 'normalised');
  });

  it('enforces the documented 32-character limit', () => {
    const long = `${'a'.repeat(31)}.com`;
    assert.ok(long.length > MAX_DOMAIN_LENGTH);
    assert.equal(validateDomainHostname(long).ok, false);
    assert.match(validateDomainHostname(long).reason ?? '', /32 characters/);
  });

  it('rejects the canonical domain and a www prefix', () => {
    assert.equal(validateDomainHostname('go.example.com', 'go.example.com').ok, false);
    assert.equal(validateDomainHostname('www.go.example.com').ok, false);
  });

  it('rejects things that are not hostnames', () => {
    for (const bad of ['', '   ', 'nodot', 'a..b', '-lead.com', 'trail-.com', 'a b.com']) {
      assert.equal(isPlausibleHostname(bad), false, bad);
    }
    assert.equal(isPlausibleHostname('.leading.com'), false);
    assert.equal(isPlausibleHostname('trailing.com.'), false);
    assert.equal(isPlausibleHostname('sh.example.com'), true);
  });
});

describe('txt verification', () => {
  it('passes when the token is present', async () => {
    const r = await verifyTxtRecord('sh.example.com', 'go-verify-abc', async () => [['go-verify-abc']]);
    assert.equal(r.ok, true);
  });

  it('scans every returned record, not just the first', async () => {
    const r = await verifyTxtRecord('sh.example.com', 'go-verify-abc', async () => [
      ['v=spf1 -all'],
      ['go-verify-abc']
    ]);
    assert.equal(r.ok, true);
  });

  it('reports a wrong token and shows what was expected', async () => {
    const r = await verifyTxtRecord('sh.example.com', 'go-verify-abc', async () => [['something-else']]);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /go-verify-abc/);
  });

  it('reports a missing record distinctly from a wrong one', async () => {
    const missing = await verifyTxtRecord('sh.example.com', 't', async () => []);
    assert.match(missing.reason ?? '', /No TXT record/);
  });

  it('does not tell an owner their record is wrong when DNS is merely down', async () => {
    // A resolver timeout says nothing about the owner's configuration, and
    // saying "wrong token" here would send them chasing a non-existent problem.
    const timedOut = await verifyTxtRecord('sh.example.com', 't', async () => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
    });
    assert.match(timedOut.reason ?? '', /Try again/i);
    assert.doesNotMatch(timedOut.reason ?? '', /token/i);

    const servfail = await verifyTxtRecord('sh.example.com', 't', async () => {
      throw Object.assign(new Error('servfail'), { code: 'ESERVFAIL' });
    });
    assert.match(servfail.reason ?? '', /Try again/i);
  });

  it('distinguishes a missing record from an unreachable resolver', async () => {
    const notFound = await verifyTxtRecord('sh.example.com', 't', async () => {
      throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    });
    assert.match(notFound.reason ?? '', /No TXT record/);
  });

  it('queries the documented record name', async () => {
    let asked = '';
    await verifyTxtRecord('sh.example.com', 't', async (name) => {
      asked = name;
      return [[]];
    });
    assert.equal(asked, `${VERIFICATION_HOST}.sh.example.com`);
  });
});

describe('tokens and instructions', () => {
  it('generates prefixed, high-entropy tokens', () => {
    const t = generateVerificationToken();
    assert.match(t, /^go-verify-[a-z2-9]{24}$/);
    // Two calls must not collide.
    assert.notEqual(generateVerificationToken(), generateVerificationToken());
  });

  it('publishes both the TXT and CNAME records', () => {
    const i = dnsInstructions('sh.example.com', 'go-verify-abc', 'go.example.com');
    assert.equal(i.txt.name, VERIFICATION_HOST);
    assert.equal(i.txt.value, 'go-verify-abc');
    assert.equal(i.cname.value, 'go.example.com');
  });
});

describe('root router', () => {
  it('only serves the root for verified, active domains', () => {
    assert.equal(rootRouterActive('verified', false), true);
    assert.equal(rootRouterActive('pending', false), false);
    assert.equal(rootRouterActive('failed', false), false);
    assert.equal(rootRouterActive('disabled', false), false);
    assert.equal(rootRouterActive('verified', true), false);
  });
});
