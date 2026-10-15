import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHost,
  parseAliasDomains,
  isPlausibleHostname,
  domainConfigFromEnv,
  resolveHostScope,
  isAliasFeatureEnabled,
  ALIAS_DOMAINS_ENV
} from '../lib/links/domains';

const APP_URL = 'https://go.arjav.is-cool.dev';

test('normalizeHost lowercases and strips port and trailing dot', () => {
  assert.equal(normalizeHost('GO.Arjav.IS-Cool.dev:443'), 'go.arjav.is-cool.dev');
  assert.equal(normalizeHost('example.com.'), 'example.com');
  assert.equal(normalizeHost('  Example.COM  '), 'example.com');
});

test('normalizeHost rejects empty values', () => {
  assert.equal(normalizeHost(null), null);
  assert.equal(normalizeHost(undefined), null);
  assert.equal(normalizeHost(''), null);
  assert.equal(normalizeHost('   '), null);
  assert.equal(normalizeHost('.'), null);
});

test('parseAliasDomains splits, normalizes and dedupes', () => {
  assert.deepEqual(parseAliasDomains('a.example.com, B.Example.com ,a.example.com'), [
    'a.example.com',
    'b.example.com'
  ]);
});

test('parseAliasDomains returns empty when unset', () => {
  assert.deepEqual(parseAliasDomains(undefined), []);
  assert.deepEqual(parseAliasDomains(null), []);
  assert.deepEqual(parseAliasDomains(''), []);
  assert.deepEqual(parseAliasDomains('  ,  '), []);
});

test('plausible hostname validation', () => {
  assert.equal(isPlausibleHostname('alias.example.com'), true);
  assert.equal(isPlausibleHostname('a.co'), true);
  assert.equal(isPlausibleHostname('x.io'), true);
  assert.equal(isPlausibleHostname('has space.com'), false);
  assert.equal(isPlausibleHostname('double..dot.com'), false);
  assert.equal(isPlausibleHostname('.leading.com'), false);
  assert.equal(isPlausibleHostname('trailing.com.'), false);
  assert.equal(isPlausibleHostname('co'), false);
  assert.equal(isPlausibleHostname('a'.repeat(300)), false);
});

test('feature is disabled when ALIAS_DOMAINS is unset', () => {
  const config = domainConfigFromEnv({}, APP_URL);
  assert.equal(isAliasFeatureEnabled(config), false);
  assert.deepEqual(config.aliasDomains, []);
});

test('feature is disabled when ALIAS_DOMAINS is empty or blank', () => {
  assert.equal(isAliasFeatureEnabled(domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: '' }, APP_URL)), false);
  assert.equal(isAliasFeatureEnabled(domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: ' , ' }, APP_URL)), false);
});

test('canonical host is derived from the app url', () => {
  const config = domainConfigFromEnv({}, APP_URL);
  assert.equal(config.canonicalHost, 'go.arjav.is-cool.dev');
});

test('the canonical host is never treated as an alias', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 'go.arjav.is-cool.dev' }, APP_URL);
  assert.deepEqual(config.aliasDomains, []);
});

test('aliases are accepted when configured', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, APP_URL);
  assert.deepEqual(config.aliasDomains, ['s.example.com']);
  assert.equal(isAliasFeatureEnabled(config), true);
});

test('implausible configured hosts are ignored', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 'has space.com, good.example.com' }, APP_URL);
  assert.deepEqual(config.aliasDomains, ['good.example.com']);
});

test('canonical host resolves to the empty domain', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, APP_URL);
  assert.deepEqual(resolveHostScope('go.arjav.is-cool.dev', config), { domain: '', isAlias: false });
});

test('configured alias resolves to its own domain scope', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, APP_URL);
  assert.deepEqual(resolveHostScope('s.example.com', config), {
    domain: 's.example.com',
    isAlias: true
  });
});

test('alias matching tolerates port and case differences', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, APP_URL);
  assert.equal(resolveHostScope('S.Example.com:443', config).domain, 's.example.com');
});

test('unknown hosts degrade to the canonical domain', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, APP_URL);
  assert.deepEqual(resolveHostScope('evil.example.org', config), { domain: '', isAlias: false });
});

test('missing host falls back to the canonical domain', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, APP_URL);
  assert.deepEqual(resolveHostScope(null, config), { domain: '', isAlias: false });
});

test('every alias is ignored entirely while the feature is off', () => {
  const config = domainConfigFromEnv({}, APP_URL);
  assert.deepEqual(resolveHostScope('s.example.com', config), { domain: '', isAlias: false });
  assert.deepEqual(resolveHostScope('anything.example.com', config), { domain: '', isAlias: false });
});

test('turning the feature off restores P0 behaviour', () => {
  const on = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, APP_URL);
  const off = domainConfigFromEnv({}, APP_URL);
  assert.notDeepEqual(resolveHostScope('s.example.com', on), resolveHostScope('s.example.com', off));
  // Canonical host behaves identically in both modes.
  assert.deepEqual(
    resolveHostScope('go.arjav.is-cool.dev', on),
    resolveHostScope('go.arjav.is-cool.dev', off)
  );
});

test('a malformed app url does not crash configuration', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 's.example.com' }, 'not a url');
  assert.equal(config.canonicalHost, null);
  assert.deepEqual(config.aliasDomains, ['s.example.com']);
  // Without a canonical host, an alias host still resolves to its own scope.
  assert.equal(resolveHostScope('s.example.com', config).domain, 's.example.com');
});

test('multiple aliases all work', () => {
  const config = domainConfigFromEnv({ [ALIAS_DOMAINS_ENV]: 'a.example.com,b.example.com' }, APP_URL);
  assert.equal(resolveHostScope('a.example.com', config).isAlias, true);
  assert.equal(resolveHostScope('b.example.com', config).isAlias, true);
});