/**
 * Page lifecycle: draft, publish, scheduling.
 *
 * The spec makes three statements this module exists to honour (section 07 and
 * section 16):
 *
 *   1. "Page changes persist as a draft; public changes do not go live until
 *       'Publish changes' is selected."
 *   2. "Leaving the editor does not discard the draft."
 *   3. Scheduled content "is not shown publicly", and may "unpublish later".
 *
 * So there are two documents — `draft_blocks` and `published_blocks` — and the
 * public route reads only the published one. Publishing is therefore an
 * explicit copy, not an implicit consequence of saving.
 *
 * Scheduling is evaluated at read time rather than by a cron that flips flags.
 * A cron that misses a window leaves a page wrongly visible or wrongly hidden;
 * evaluating `now` on every render cannot drift. `nextTransitionAt` exists so a
 * sweeper can still correct `is_published` to match what the render path already
 * does, keeping the summary column honest for queries that do not go through
 * the renderer.
 */

import { parseBlocks, visibleBlocks, countImages, MAX_IMAGES_PER_PAGE, type PageBlock } from './blocks';

export type PageKind = 'bio' | 'page';

export interface PageRow {
  id: string;
  kind: PageKind;
  handle: string | null;
  slug: string | null;
  is_published: boolean;
  draft_blocks: unknown;
  published_blocks: unknown | null;
  scheduled_publish_at: string | null;
  scheduled_unpublish_at: string | null;
  published_at: string | null;
}

/** Is the page reachable by the public right now? */
export function isPubliclyVisible(page: PageRow, now = Date.now()): boolean {
  if (!page.is_published) return false;
  if (page.scheduled_publish_at && new Date(page.scheduled_publish_at).getTime() > now) {
    return false;
  }
  if (page.scheduled_unpublish_at && new Date(page.scheduled_unpublish_at).getTime() <= now) {
    return false;
  }
  return true;
}

/**
 * The blocks a visitor should be rendered.
 *
 * `published_blocks === null` means "publish has never happened on this page",
 * which is true for every page created before 0013. Those pages still have the
 * legacy fixed layout (display_name / bio / avatar / links.show_on_bio), so this
 * returns `null` rather than an empty list to signal "fall back to the fixed
 * renderer" instead of "this page is empty".
 */
export function publicBlocks(page: PageRow, now = Date.now()): PageBlock[] | null {
  if (page.published_blocks === null) return null;
  const parsed = parseBlocks(page.published_blocks);
  return visibleBlocks(parsed.blocks, now);
}

/** Blocks shown in the editor: the draft, which may be invalid while typing. */
export function draftBlocks(page: PageRow): PageBlock[] {
  return parseBlocks(page.draft_blocks).blocks;
}

/**
 * Is the draft ahead of what's live?
 *
 * Compared by value rather than by timestamp, because an editor that opens a
 * page, changes nothing and closes should not show a false "unpublished
 * changes" badge.
 */
export function hasUnpublishedChanges(page: PageRow): boolean {
  const draft = JSON.stringify(normaliseForCompare(draftBlocks(page)));
  const published =
    page.published_blocks === null ? null : JSON.stringify(normaliseForCompare(parseBlocks(page.published_blocks).blocks));
  if (published === null) return draft !== '[]';
  return draft !== published;
}

function normaliseForCompare(blocks: PageBlock[]): unknown[] {
  return blocks.map((b) => ({ ...b, schedule: b.schedule ?? null }));
}

/**
 * Publish the draft.
 *
 * Returns the column values to write. Validation is advisory: a page can be
 * published with some blocks rejected, and the caller is told which, rather
 * than refusing to publish at all. An editor who fixed three of four blocks
 * should see three of four go live, not a dead end.
 */
export function preparePublish(
  draft: unknown,
  options: { now?: number } = {}
): {
  patch: {
    published_blocks: unknown;
    is_published: boolean;
    published_at: string | null;
  };
  blocks: PageBlock[];
  errors: string[];
  imageOverflow: boolean;
} {
  const now = options.now ?? Date.now();
  const parsed = parseBlocks(draft);

  /**
   * A block can be a legitimate draft placeholder and still be unfit to go
   * live — a link button the editor has labelled but not yet pointed anywhere,
   * most often. Those are kept in the draft (they are mid-edit work, not
   * mistakes) but withheld from the published document, because a dead button
   * on a public page is worse than one missing from it.
   */
  const blocks: PageBlock[] = [];
  for (const block of parsed.blocks) {
    if (isPublishable(block)) {
      blocks.push(block);
    } else {
      parsed.errors.push(`block ${block.blockId}: incomplete ${block.type} block withheld from publish`);
    }
  }

  return {
    patch: {
      published_blocks: blocks,
      is_published: true,
      published_at: new Date(now).toISOString()
    },
    blocks,
    errors: parsed.errors,
    imageOverflow: countImages(blocks) > MAX_IMAGES_PER_PAGE
  };
}

/**
 * Can this block render something a visitor can actually use?
 *
 * `parseBlocks` already guarantees the payload is well-formed; this is the
 * stricter "is it finished" check that only publish applies.
 */
function isPublishable(block: PageBlock): boolean {
  switch (block.type) {
    case 'link':
      return Boolean(block.href || block.linkId);
    case 'text':
      return block.text.trim().length > 0;
    case 'image':
      return Boolean(block.url);
    case 'image_grid':
    case 'image_carousel':
      return block.images.length > 0;
    case 'youtube':
      return Boolean(block.videoId);
    case 'social':
      return block.networks.length > 0;
    case 'contact':
      return true;
    default:
      return false;
  }
}

/**
 * Save without publishing.
 *
 * Scheduling a future publish time sets `is_published` so that the existing
 * visibility checks honour it; the render path additionally enforces the time
 * window itself, so a missed or early cron cannot expose the page.
 */
export function prepareSave(
  draft: unknown,
  options: {
    scheduledPublishAt?: string | null;
    scheduledUnpublishAt?: string | null;
    wasPublished?: boolean;
  } = {}
): { patch: { draft_blocks: unknown; scheduled_publish_at: string | null; scheduled_unpublish_at: string | null; is_published: boolean } } {
  const parsed = parseBlocks(draft);
  const scheduled = options.scheduledPublishAt ?? null;

  return {
    patch: {
      draft_blocks: parsed.blocks,
      scheduled_publish_at: scheduled,
      scheduled_unpublish_at: options.scheduledUnpublishAt ?? null,
      // Keep the page live if it already was and the new window has not closed.
      is_published: options.wasPublished === true || scheduled !== null
    }
  };
}

/**
 * When `is_published` next needs correcting, or null if nothing is pending.
 *
 * Intended for the nightly sweep: the render path is already correct, this only
 * keeps the denormalised flag in step so simple queries agree with it.
 */
export function nextTransitionAt(page: PageRow, now = Date.now()): number | null {
  const times: number[] = [];
  if (page.scheduled_publish_at) times.push(new Date(page.scheduled_publish_at).getTime());
  if (page.scheduled_unpublish_at) times.push(new Date(page.scheduled_unpublish_at).getTime());
  const upcoming = times.filter((t) => t > now).sort((a, b) => a - b);
  return upcoming.length ? upcoming[0] : null;
}