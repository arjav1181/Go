import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactString, correlationIdFrom } from '../lib/log';

test('authorization headers are redacted', () => {
  const out = redact({ authorization: 'Bearer go_supersecretkey123' });
  assert.equal(out.authorization, '[redacted]');
});

test('cookies and secrets are redacted regardless of casing', () => {
  const out = redact({
    Cookie: 'sb-access-token=abc',
    PASSWORD: 'hunter2',
    'Api-Key': 'go_abc',
    TOKEN: 'x'
  });
  for (const value of Object.values(out)) assert.equal(value, '[redacted]');
});

test('destination urls and private notes never reach the log', () => {
  const out = redact({ destination_url: 'https://secret.example/private', notes: 'private note' });
  assert.equal(out.destination_url, '[redacted]');
  assert.equal(out.notes, '[redacted]');
});

test('caller network identifiers are redacted', () => {
  const out = redact({ ip: '1.2.3.4', 'x-forwarded-for': '5.6.7.8', referer: 'https://x.example/p' });
  assert.equal(out.ip, '[redacted]');
  assert.equal(out['x-forwarded-for'], '[redacted]');
  assert.equal(out.referer, '[redacted]');
});

test('user agent is never logged', () => {
  const out = redact({ 'user-agent': 'Mozilla/5.0 (iPhone)' });
  assert.equal(out['user-agent'], '[redacted]');
});

test('bearer tokens embedded in free text are stripped', () => {
  const out = redactString('failed with Bearer go_abcdefghijklmnopqrst');
  assert.ok(!out.includes('go_abcdefghijklmnopqrst'));
  assert.match(out, /\[redacted\]/);
});

test('api keys embedded in free text are stripped', () => {
  const out = redactString('key was go_abcdefghijklmnopqrstuvwx');
  assert.ok(!out.includes('go_abcdefghijklmnopqrstuvwx'));
  assert.match(out, /\[redacted-key\]/);
});

test('ordinary short values survive', () => {
  const out = redact({ event: 'link.created', count: 3, ok: true, slug: 'example' });
  assert.equal(out.event, 'link.created');
  assert.equal(out.count, 3);
  assert.equal(out.ok, true);
  assert.equal(out.slug, 'example');
});

test('long strings are truncated', () => {
  const out = redactString('x'.repeat(500));
  assert.ok(out.length < 220);
});

test('arrays are bounded and scalar-filtered', () => {
  const out = redact({ items: Array.from({ length: 100 }, (_, i) => i) });
  assert.equal((out.items as unknown[]).length, 20);
});

test('nested objects are dropped rather than risking a leak', () => {
  const out = redact({ nested: { password: 'secret' } });
  assert.equal(out.nested, '[object]');
});

test('null and undefined are preserved', () => {
  const out = redact({ a: null, b: undefined });
  assert.equal(out.a, null);
  assert.equal(out.b, undefined);
});

test('correlation ids are taken from a well-formed header', () => {
  const id = correlationIdFrom(new Headers({ 'x-request-id': 'abc12345' }));
  assert.equal(id, 'abc12345');
});

test('a malformed request id is not trusted', () => {
  const id = correlationIdFrom(new Headers({ 'x-request-id': '<script>alert(1)</script>' }));
  assert.ok(!id.includes('script'));
  assert.match(id, /^req_/);
});

test('correlation ids are generated when absent', () => {
  const id = correlationIdFrom(new Headers());
  assert.match(id, /^req_[a-z0-9]+$/);
});

test('correlation ids differ between requests', () => {
  const a = correlationIdFrom(new Headers());
  const b = correlationIdFrom(new Headers());
  assert.notEqual(a, b);
});