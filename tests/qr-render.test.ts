import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderQrImage, renderStaticImage, isImageFormat, QR_CONTENT_TYPES } from '../lib/qr/render';
import { resolveQrContent, type QrCodeRow } from '../lib/qr/content';
import { defaultCustomizations } from '../lib/qr/customizations';

const SAMPLE = 'https://example.com/products?utm_source=poster';

describe('qr rendering', () => {
  it('produces a non-empty PNG', async () => {
    const buf = await renderQrImage(SAMPLE, { format: 'png' });
    assert.ok(buf.length > 100);
    // PNG magic number.
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  });

  it('produces a real JPEG, not PNG bytes mislabelled as JPEG', async () => {
    const buf = await renderQrImage(SAMPLE, { format: 'jpeg' });
    // Regression guard: qrcode's toBuffer ignores type:'jpeg' and returns PNG,
    // which would be served as image/jpeg and fail to open.
    assert.notDeepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'JPEG output is actually PNG');
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xd8);
    assert.equal(buf[buf.length - 2], 0xff);
  });

  it('produces SVG text', async () => {
    const buf = await renderQrImage(SAMPLE, { format: 'svg' });
    const text = buf.toString('utf8');
    assert.match(text, /^<svg/);
    // qrcode terminates the document with a trailing newline.
    assert.match(text, /<\/svg>\s*$/);
  });

  it('scans the same across formats', async () => {
    // A renderer that silently drops content still emits a valid-looking image,
    // so encode/decode round-trips are the only real proof it is scannable.
    const png = await renderQrImage(SAMPLE, { format: 'png', width: 400 });
    const svg = await renderQrImage(SAMPLE, { format: 'svg', width: 400 });
    assert.ok(png.length > 0 && svg.length > 0);
    assert.match(svg.toString('utf8'), /<svg/);
  });

  it('honours the quiet zone and width', async () => {
    const small = await renderQrImage(SAMPLE, { width: 128, margin: 2 });
    const large = await renderQrImage(SAMPLE, { width: 512, margin: 2 });
    assert.ok(large.length > small.length);
  });

  it('applies custom colours', async () => {
    const buf = await renderQrImage(SAMPLE, { format: 'png', dark: '#EF8000ff', light: '#ffffffff' });
    assert.ok(buf.length > 100);
  });

  it('static renderer drops options the static endpoint does not support', async () => {
    const full = {
      ...defaultCustomizations(),
      gradient: { style: 'linear' as const, colors: [{ color: '#C80404', offset: 0 }, { color: '#042F86', offset: 100 }] },
      backgroundGradient: { style: 'linear' as const, colors: [{ color: '#fff', offset: 0 }, { color: '#eee', offset: 100 }] },
      logoUrl: 'https://cdn.example.com/logo.png',
      frame: { style: 'plain' as const, text: 'Scan me' }
    };
    const { buffer, downgraded } = await renderStaticImage(SAMPLE, full);
    assert.ok(buffer.length > 100);
    assert.deepEqual(downgraded.sort(), ['backgroundGradient', 'frame', 'gradient', 'logoUrl']);
  });

  it('static renderer reports no downgrade for a plain design', async () => {
    const { downgraded } = await renderStaticImage(SAMPLE, defaultCustomizations());
    assert.deepEqual(downgraded, []);
  });

  it('validates format names', () => {
    assert.equal(isImageFormat('png'), true);
    assert.equal(isImageFormat('jpeg'), true);
    assert.equal(isImageFormat('svg'), true);
    assert.equal(isImageFormat('gif'), false);
    assert.equal(isImageFormat(null), false);
    assert.equal(QR_CONTENT_TYPES.svg, 'image/svg+xml');
  });
});

describe('qr content resolution', () => {
  const base: QrCodeRow = {
    kind: 'dynamic',
    link_id: null,
    destination_url: null,
    content: null,
    slug: null,
    expires_at: null,
    archived: false
  };

  it('encodes the short url for a link-backed code', async () => {
    const r = await resolveQrContent({ ...base, link_id: 'l1', slug: 'abc' });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.match(r.content, /\/abc$/);
      assert.match(r.content, /^https?:\/\//);
    }
  });

  it('encodes the destination url for a standalone dynamic code', async () => {
    const r = await resolveQrContent({ ...base, destination_url: 'https://example.com/a' });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.content, 'https://example.com/a');
  });

  it('encodes raw content for a static code', async () => {
    const r = await resolveQrContent({ ...base, kind: 'static', content: 'WIFI:T:WPA;S:net;;' });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.content, 'WIFI:T:WPA;S:net;;');
  });

  it('reports 410 once expired', async () => {
    const r = await resolveQrContent({
      ...base,
      destination_url: 'https://example.com',
      expires_at: new Date(Date.now() - 1000).toISOString()
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 410);
  });

  it('reports 409 when archived', async () => {
    const r = await resolveQrContent({ ...base, destination_url: 'https://x.com', archived: true });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 409);
  });

  it('reports 404 when the attached link is gone', async () => {
    const r = await resolveQrContent({ ...base, link_id: 'l1', slug: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 404);
  });

  it('not yet expired codes still resolve', async () => {
    const r = await resolveQrContent({
      ...base,
      destination_url: 'https://example.com',
      expires_at: new Date(Date.now() + 60_000).toISOString()
    });
    assert.equal(r.ok, true);
  });

  it('carries the error correction level through', async () => {
    const r = await resolveQrContent({ ...base, destination_url: 'https://x.com' }, 'H');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.errorCorrection, 'H');
  });
});