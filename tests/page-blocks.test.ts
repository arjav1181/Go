import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBlocks,
  visibleBlocks,
  isBlockVisible,
  countImages,
  safeHttpUrl,
  extractYoutubeId,
  BLOCK_TYPES,
  MAX_BLOCKS_PER_PAGE,
  type PageBlock,
  type LinkBlock
} from '../lib/pages/blocks';
import {
  isPubliclyVisible,
  publicBlocks,
  draftBlocks,
  hasUnpublishedChanges,
  preparePublish,
  prepareSave,
  nextTransitionAt,
  type PageRow
} from '../lib/pages/lifecycle';
import { PAGE_TEMPLATES, seedBlocks, findTemplate } from '../lib/pages/templates';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function linkBlock(over: Partial<PageBlock> = {}): PageBlock {
  return {
    blockId: uuid(1),
    type: 'link',
    position: 0,
    pinned: false,
    label: 'Example',
    href: 'https://example.com',
    ...over
  } as PageBlock;
}

function pageRow(over: Partial<PageRow> = {}): PageRow {
  return {
    id: uuid(99),
    kind: 'bio',
    handle: 'tester',
    slug: null,
    is_published: true,
    draft_blocks: [],
    published_blocks: null,
    scheduled_publish_at: null,
    scheduled_unpublish_at: null,
    published_at: null,
    ...over
  };
}

describe('page blocks', () => {
  it('parses all eight spec block types', () => {
    assert.equal(BLOCK_TYPES.length, 8);
    const raw = [
      { type: 'link', label: 'Site', href: 'https://example.com' },
      { type: 'text', text: 'Hello' },
      { type: 'image', url: 'https://cdn.example.com/a.png', alt: 'a' },
      { type: 'image_grid', images: [{ url: 'https://cdn.example.com/a.png', alt: '' }] },
      { type: 'image_carousel', images: [{ url: 'https://cdn.example.com/a.png', alt: '' }] },
      { type: 'youtube', videoId: 'dQw4w9WgXcQ' },
      { type: 'contact', showEmail: true, showPhone: false, allowDownload: true },
      { type: 'social', networks: [{ network: 'github', href: 'https://github.com/x' }] }
    ];
    const r = parseBlocks(raw);
    assert.equal(r.errors.length, 0, r.errors.join('; '));
    assert.equal(r.blocks.length, 8);
    for (const t of BLOCK_TYPES) {
      assert.ok(r.blocks.some((b) => b.type === t), `missing ${t}`);
    }
  });

  it('rejects javascript: and data: hrefs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
      const r = parseBlocks([{ type: 'link', label: 'x', href: bad }]);
      assert.match(r.errors.join(' '), /unsafe href/, `${bad} should be rejected`);
    }
  });

  it('accepts only http(s) urls', () => {
    assert.equal(safeHttpUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
    assert.equal(safeHttpUrl('http://example.com'), 'http://example.com');
    for (const bad of ['ftp://x.com', 'file:///etc/passwd', '//example.com', '/relative', '', 'javascript:void 0']) {
      assert.equal(safeHttpUrl(bad), null, `${bad} should be rejected`);
    }
  });

  it('drops unsafe image urls instead of the whole block', () => {
    const r = parseBlocks([
      { type: 'image', url: 'https://cdn.example.com/ok.png', alt: 'ok' },
      { type: 'image', url: 'javascript:alert(1)', alt: 'bad' }
    ]);
    assert.equal(r.blocks.length, 1);
    assert.match(r.errors.join(' '), /valid http\(s\) url/);
  });

  it('extracts youtube ids from every documented url shape', () => {
    const id = 'dQw4w9WgXcQ';
    for (const input of [
      id,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/watch?list=x&v=${id}`
    ]) {
      assert.equal(extractYoutubeId(input), id, `${input} should yield the id`);
    }
    assert.equal(extractYoutubeId('https://vimeo.com/12345'), null);
    assert.equal(extractYoutubeId('too-short'), null);
    // A bare 11-character token is indistinguishable from a real id by format,
    // so it is accepted; validation cannot do better than the alphabet allows.
    assert.equal(extractYoutubeId('not-a-video'), 'not-a-video');
  });

  it('mints block ids when missing and keeps existing ones', () => {
    const r = parseBlocks([
      { type: 'text', text: 'no id' },
      { blockId: 'keep-me', type: 'text', text: 'has id' }
    ]);
    assert.ok(r.blocks[0].blockId && r.blocks[0].blockId.length > 10);
    assert.equal(r.blocks[1].blockId, 'keep-me');
  });

  it('drops duplicate block ids, which would corrupt per-block analytics', () => {
    const r = parseBlocks([
      { blockId: uuid(7), type: 'text', text: 'a' },
      { blockId: uuid(7), type: 'text', text: 'b' }
    ]);
    assert.equal(r.blocks.length, 1);
    assert.match(r.errors.join(' '), /duplicate block id/);
  });

  it('one bad block does not take the page down', () => {
    const r = parseBlocks([
      { type: 'link', label: 'good', href: 'https://example.com' },
      { type: 'nonsense' },
      { type: 'text', text: 'also good' }
    ]);
    assert.equal(r.blocks.length, 2);
    assert.ok(r.errors.length >= 1);
  });

  it('caps blocks at the per-page limit', () => {
    const many = Array.from({ length: MAX_BLOCKS_PER_PAGE + 10 }, (_, i) => ({
      blockId: uuid(1000 + i),
      type: 'text',
      text: `b${i}`
    }));
    const r = parseBlocks(many);
    assert.equal(r.blocks.length, MAX_BLOCKS_PER_PAGE);
    assert.match(r.errors.join(' '), /limit/);
  });

  it('ignores an inverted schedule window', () => {
    const r = parseBlocks([
      { blockId: uuid(3), type: 'text', text: 'x', schedule: { from: 2000, until: 1000 } }
    ]);
    assert.equal(r.blocks[0].schedule, undefined);
    assert.match(r.errors.join(' '), /ends before it starts/);
  });

  it('counts images across every image-bearing block type', () => {
    const blocks = parseBlocks([
      { type: 'image', url: 'https://cdn.example.com/1.png', alt: '' },
      { type: 'image_grid', images: [
        { url: 'https://cdn.example.com/2.png', alt: '' },
        { url: 'https://cdn.example.com/3.png', alt: '' }
      ] },
      { type: 'image_carousel', images: [{ url: 'https://cdn.example.com/4.png', alt: '' }] },
      { type: 'text', text: 'not an image' }
    ]).blocks;
    assert.equal(countImages(blocks), 4);
  });

  it('hides blocks outside their schedule window', () => {
    const now = 10_000;
    const text = {
      blockId: 'a',
      type: 'text',
      position: 0,
      pinned: false,
      text: 'x',
      style: 'body'
    } as const;
    // Window already closed.
    assert.equal(isBlockVisible({ ...text, schedule: { from: 0, until: 5_000 } }, now), false);
    // Window has not opened yet.
    assert.equal(isBlockVisible({ ...text, schedule: { from: 50_000 } }, now), false);
    // Window currently open.
    assert.equal(isBlockVisible({ ...text, schedule: { from: 0, until: 50_000 } }, now), true);
    // No window at all.
    assert.equal(isBlockVisible(text, now), true);
  });

  it('sorts pinned blocks first, then by position', () => {
    const blocks = parseBlocks([
      { blockId: 'c', type: 'text', position: 20, text: 'c' },
      { blockId: 'a', type: 'text', position: 10, pinned: true, text: 'a' },
      { blockId: 'b', type: 'text', position: 5, text: 'b' }
    ]).blocks;
    assert.deepEqual(visibleBlocks(blocks).map((b) => b.blockId), ['a', 'b', 'c']);
  });

  it('unpinning restores position order rather than scrambling it', () => {
    const blocks = parseBlocks([
      { blockId: 'c', type: 'text', position: 20, text: 'c' },
      { blockId: 'a', type: 'text', position: 10, text: 'a' },
      { blockId: 'b', type: 'text', position: 5, pinned: true, text: 'b' }
    ]).blocks;
    const pinned = visibleBlocks(blocks).map((b) => b.blockId);
    assert.deepEqual(pinned, ['b', 'a', 'c']);
    const unpinned = visibleBlocks(blocks.map((b) => (b.blockId === 'b' ? { ...b, pinned: false } : b))).map(
      (b) => b.blockId
    );
    assert.deepEqual(unpinned, ['b', 'a', 'c']);
  });
});

describe('page lifecycle', () => {
  it('draft changes are not public until published', () => {
    const page = pageRow({
      draft_blocks: [linkBlock()],
      published_blocks: null
    });
    assert.equal(publicBlocks(page), null, 'never-published page falls back to the fixed layout');
    assert.equal(draftBlocks(page).length, 1);
  });

  it('publish copies the draft to the published document', () => {
    const draft = [linkBlock()];
    const { patch, blocks } = preparePublish(draft);
    assert.equal(patch.is_published, true);
    assert.equal((patch.published_blocks as PageBlock[]).length, 1);
    assert.equal(blocks.length, 1);
    assert.ok(patch.published_at);
  });

  it('publishing reports bad blocks but does not refuse to publish', () => {
    const { errors, blocks, patch } = preparePublish([
      linkBlock(),
      { type: 'link', label: 'bad', href: 'javascript:alert(1)' }
    ]);
    assert.equal(blocks.length, 1);
    assert.ok(errors.length > 0);
    assert.equal(patch.is_published, true);
  });

  it('saving does not change what is live', () => {
    const page = pageRow({ published_blocks: [linkBlock()], draft_blocks: [linkBlock({ label: 'new' } as Partial<PageBlock>)] });
    const before = publicBlocks(page);
    const { patch } = prepareSave([linkBlock({ label: 'new' } as Partial<PageBlock>)], { wasPublished: true });
    assert.equal(patch.is_published, true);
    assert.equal((before?.[0] as LinkBlock).label, 'Example', 'live document unchanged by a save');
  });

  it('detects unpublished changes by value, not timestamp', () => {
    const same = [linkBlock()];
    assert.equal(
      hasUnpublishedChanges(pageRow({ draft_blocks: same, published_blocks: same })),
      false,
      'an editor that changes nothing should not show a false badge'
    );
    const changed = [linkBlock({ label: 'different' } as Partial<PageBlock>)];
    assert.equal(hasUnpublishedChanges(pageRow({ draft_blocks: changed, published_blocks: same })), true);
  });

  it('treats a first-ever publish of a non-empty draft as a change', () => {
    assert.equal(hasUnpublishedChanges(pageRow({ draft_blocks: [], published_blocks: null })), false);
    assert.equal(hasUnpublishedChanges(pageRow({ draft_blocks: [linkBlock()], published_blocks: null })), true);
  });

  it('hides a page until its scheduled publish time', () => {
    const now = 1_000_000;
    const page = pageRow({
      is_published: true,
      scheduled_publish_at: new Date(now + 60_000).toISOString()
    });
    assert.equal(isPubliclyVisible(page, now), false);
    assert.equal(isPubliclyVisible(page, now + 120_000), true);
  });

  it('hides a page after its scheduled unpublish time', () => {
    const now = 1_000_000;
    const page = pageRow({
      is_published: true,
      scheduled_unpublish_at: new Date(now - 1).toISOString()
    });
    assert.equal(isPubliclyVisible(page, now), false);
  });

  it('an unpublished page is never public', () => {
    assert.equal(isPubliclyVisible(pageRow({ is_published: false })), false);
  });

  it('scheduled-out blocks are omitted but not deleted', () => {
    const now = 1_000_000;
    const blocks = [
      { blockId: 'live', type: 'text', position: 0, text: 'live', style: 'body' as const },
      { blockId: 'later', type: 'text', position: 10, text: 'later', style: 'body' as const, schedule: { from: now + 1000 } }
    ];
    const page = pageRow({ published_blocks: blocks });
    const shown = publicBlocks(page, now) ?? [];
    assert.deepEqual(shown.map((b) => b.blockId), ['live']);
    // Still in the stored document, so it returns when the window opens.
    assert.equal((page.published_blocks as unknown[]).length, 2);
    const later = publicBlocks(page, now + 2000) ?? [];
    assert.equal(later.length, 2);
  });

  it('reports the next scheduled transition for the sweeper', () => {
    const now = 1_000_000;
    const page = pageRow({
      scheduled_publish_at: new Date(now + 5000).toISOString(),
      scheduled_unpublish_at: new Date(now + 9000).toISOString()
    });
    assert.equal(nextTransitionAt(page, now), now + 5000);
    assert.equal(nextTransitionAt(pageRow(), now), null);
  });
});

describe('page templates', () => {
  it('every template id is unique and resolvable', () => {
    const ids = PAGE_TEMPLATES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.ok(findTemplate(id), `${id} should resolve`);
  });

  it('only names themes the database accepts', () => {
    // bio_pages_theme_valid constrains to minimal/card/grid.
    for (const t of PAGE_TEMPLATES) {
      assert.ok(['minimal', 'card', 'grid'].includes(t.theme), `${t.id} uses unsupported theme ${t.theme}`);
    }
  });

  it('seeding a blank page yields no placeholder blocks', () => {
    assert.deepEqual(seedBlocks('blank'), []);
    assert.deepEqual(seedBlocks('does-not-exist'), []);
  });

  it('seeding never emits blocks that cannot render', () => {
    for (const t of PAGE_TEMPLATES) {
      const blocks = seedBlocks(t.id);
      for (const b of blocks) {
        if (b.type === 'youtube') assert.ok(b.videoId.length > 0);
        if (b.type === 'image') assert.ok(b.url.length > 0);
        if (b.type === 'social') assert.ok(b.networks.length > 0);
        if (b.type === 'image_grid' || b.type === 'image_carousel') assert.ok(b.images.length > 0);
      }
    }
  });

  it('every seeded block survives a parse round trip', () => {
    for (const t of PAGE_TEMPLATES) {
      const seeded = seedBlocks(t.id);
      const parsed = parseBlocks(seeded);
      assert.deepEqual(
        parsed.blocks.map((b) => b.blockId),
        seeded.map((b) => b.blockId),
        `${t.id} did not round trip`
      );
    }
  });
});