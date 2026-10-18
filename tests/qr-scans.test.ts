import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanPath, SCAN_REFERRER } from '../lib/qr/scans';
import { applyTargets, type ResolvedTargets } from '../lib/pages/targets';
import { parseBlocks, type PageBlock } from '../lib/pages/blocks';
import { isReservedReferrer } from '../lib/analytics/device-category';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('qr scan path', () => {
  it('encodes an id the scan route can parse', () => {
    assert.equal(scanPath('abc-123'), '/scan/abc-123');
    assert.ok(!scanPath('a/b').includes('//'), 'must not produce a path traversal');
  });

  it('uses the documented reserved referrer for scans', () => {
    // Spec section 09: scans appear as "Bitly QR Code" in the referrer list.
    assert.equal(SCAN_REFERRER, 'Bitly QR Code');
    assert.equal(isReservedReferrer(SCAN_REFERRER), true);
  });
});

describe('page block target resolution', () => {
  const blocks = parseBlocks([
    { blockId: 'b1', type: 'link', label: 'Managed', linkId: uuid(1) },
    { blockId: 'b2', type: 'link', label: 'Direct', href: 'https://example.com/x' },
    { blockId: 'b3', type: 'text', text: 'hello' }
  ]).blocks as PageBlock[];

  it('fills href from a resolved linkId', () => {
    const targets: ResolvedTargets = new Map([[uuid(1), 'https://resolved.example/']]);
    const out = applyTargets(blocks, targets);
    const first = out[0] as Extract<PageBlock, { type: 'link' }>;
    assert.equal(first.href, 'https://resolved.example/');
    assert.equal(first.linkId, uuid(1), 'keeps the linkId so the scan path still works');
  });

  it('never overrides an explicit href', () => {
    const targets: ResolvedTargets = new Map([[uuid(1), 'https://resolved.example/']]);
    const out = applyTargets(blocks, targets);
    const second = out[1] as Extract<PageBlock, { type: 'link' }>;
    assert.equal(second.href, 'https://example.com/x');
  });

  it('leaves a link unresolved when its target no longer exists', () => {
    // Deleted, disabled or expired links are not in the map, and the block must
    // stay href-less so the renderer omits it rather than showing a dead button.
    const out = applyTargets(blocks, new Map());
    const first = out[0] as Extract<PageBlock, { type: 'link' }>;
    assert.equal(first.href, undefined);
  });

  it('is a no-op when nothing needs resolving', () => {
    assert.equal(applyTargets(blocks, new Map()), blocks, 'same array reference');
  });

  it('does not mutate the input blocks', () => {
    const before = JSON.stringify(blocks);
    applyTargets(blocks, new Map([[uuid(1), 'https://x.example/']]));
    assert.equal(JSON.stringify(blocks), before);
  });
});
