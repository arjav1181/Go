/**
 * Page blocks.
 *
 * The block model from spec sheet section 07: link button, text, inline image,
 * image grid, image carousel, YouTube video, contact card, social icons.
 *
 * Design notes
 * ------------
 * **Blocks carry their own stable `blockId`.** Drag-and-drop reorders the array
 * but must not mint new ids, because per-block click analytics aggregates on
 * this value. Losing it would silently reset a popular block's stats on every
 * reorder.
 *
 * **`pinned` beats position.** The spec lets an editor pin an item to the top
 * and drag the rest around it. Modelling that as a sort key rather than
 * "actually moving the row" means unpinning restores the original order
 * instead of scrambling it.
 *
 * **Scheduling omits, never deletes.** A block outside its window is left in
 * the array and skipped at render time, so it reappears when the window reopens.
 *
 * **URLs are validated here, not just at the UI.** Blocks are stored as jsonb
 * and can arrive from the bulk importer, so the schema is the enforcement
 * boundary. Every outbound href must be http(s) — `javascript:` and `data:` are
 * rejected outright, because a page block is exactly the kind of content that
 * gets shared and clicked by someone other than its author.
 */

/** The eight block types in the spec. */
export const BLOCK_TYPES = [
  'link',
  'text',
  'image',
  'image_grid',
  'image_carousel',
  'youtube',
  'contact',
  'social'
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Spec limits. */
export const MAX_BLOCKS_PER_PAGE = 100;
/** "Help documentation states a maximum of 100 uploaded images per Page". */
export const MAX_IMAGES_PER_PAGE = 100;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_LABEL_LENGTH = 120;
/** YouTube ids are 11 characters; a full watch/shorts/embed URL is accepted too. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface BlockSchedule {
  /** Unix ms. Block is hidden before this. */
  from?: number;
  /** Unix ms. Block is hidden at and after this. */
  until?: number;
}

/**
 * Shared envelope. `type` is deliberately not here: it lives on each concrete
 * block so that a switch on `block.type` narrows the union.
 */
export interface BaseBlock {
  blockId: string;
  /** Sorts after pinned blocks; gaps of 10 leave room for insertion. */
  position: number;
  pinned: boolean;
  schedule?: BlockSchedule;
  /** Hidden in the editor but kept in the document. */
  disabled?: boolean;
}

export interface LinkBlock extends BaseBlock {
  type: 'link';
  label: string;
  /** Shown under the label. */
  description?: string;
  /** Either an external href or a Bitly link id. */
  href?: string;
  /** Resolve href through a Bitly link so it is measurable and editable. */
  linkId?: string;
  thumbnailUrl?: string;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  text: string;
  /** 'body' allows paragraphs; 'heading' is a single larger line. */
  style: 'body' | 'heading';
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  url: string;
  alt: string;
  width?: number;
  height?: number;
  /** Optional outbound link around the image. */
  href?: string;
  title?: string;
}

export interface ImageGridBlock extends BaseBlock {
  type: 'image_grid';
  images: Array<{ url: string; alt: string; href?: string }>;
}

export interface ImageCarouselBlock extends BaseBlock {
  type: 'image_carousel';
  images: Array<{ url: string; alt: string; href?: string }>;
}

export interface YoutubeBlock extends BaseBlock {
  type: 'youtube';
  videoId: string;
  title?: string;
  startAt?: number;
}

export interface ContactBlock extends BaseBlock {
  type: 'contact';
  /** Contact details live on the page row; this block renders and counts them. */
  showEmail: boolean;
  showPhone: boolean;
  /** Enables the measured "download contact" action. */
  allowDownload: boolean;
  label?: string;
}

export interface SocialBlock extends BaseBlock {
  type: 'social';
  networks: Array<{ network: SocialNetwork; href: string }>;
}

export const SOCIAL_NETWORKS = [
  'x',
  'instagram',
  'linkedin',
  'youtube',
  'github',
  'facebook',
  'tiktok',
  'threads'
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export type PageBlock =
  | LinkBlock
  | TextBlock
  | ImageBlock
  | ImageGridBlock
  | ImageCarouselBlock
  | YoutubeBlock
  | ContactBlock
  | SocialBlock;

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

/**
 * Only absolute http(s) URLs.
 *
 * Deliberately stricter than `normalizeDestinationUrl` in lib/links: page
 * blocks are rendered inline on a page that may be shared publicly, so
 * relative URLs (which are legitimate for short-link destinations) are not
 * useful here and are rejected.
 */
export function safeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return trimmed;
}

/**
 * Accept either a bare 11-char YouTube id or any of the URL shapes YouTube
 * hands out, and return the id.
 */
export function extractYoutubeId(value: string): string | null {
  const trimmed = value.trim();
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParseBlocksResult {
  ok: boolean;
  blocks: PageBlock[];
  errors: string[];
}

/**
 * Parse an arbitrary payload into blocks.
 *
 * Unknown block types and malformed blocks are reported in `errors` and skipped
 * rather than aborting the parse, so one bad block cannot take a whole page
 * offline. A page that renders three of four blocks beats one that renders
 * nothing.
 */
export function parseBlocks(input: unknown): ParseBlocksResult {
  const errors: string[] = [];
  if (input === undefined || input === null) return { ok: true, blocks: [], errors };

  if (!Array.isArray(input)) {
    return { ok: false, blocks: [], errors: ['blocks must be an array'] };
  }

  if (input.length > MAX_BLOCKS_PER_PAGE) {
    errors.push(`page has ${input.length} blocks, over the ${MAX_BLOCKS_PER_PAGE} limit; extras dropped`);
  }

  const blocks: PageBlock[] = [];
  const seenIds = new Set<string>();

  for (const raw of input.slice(0, MAX_BLOCKS_PER_PAGE)) {
    const parsed = parseBlock(raw, errors);
    if (!parsed) continue;
    // Duplicate ids would make per-block analytics ambiguous.
    if (seenIds.has(parsed.blockId)) {
      errors.push(`duplicate block id ${parsed.blockId} dropped`);
      continue;
    }
    seenIds.add(parsed.blockId);
    blocks.push(parsed);
  }

  return { ok: errors.length === 0, blocks, errors };
}

function parseBlock(raw: unknown, errors: string[]): PageBlock | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('block must be an object');
    return null;
  }
  const b = raw as Record<string, unknown>;

  const blockId = typeof b.blockId === 'string' && b.blockId ? b.blockId : crypto.randomUUID();
  const position = typeof b.position === 'number' && Number.isFinite(b.position) ? b.position : 0;
  const pinned = b.pinned === true;
  const base: BaseBlock = { blockId, position, pinned };
  if (b.disabled === true) base.disabled = true;

  if (b.schedule && typeof b.schedule === 'object' && !Array.isArray(b.schedule)) {
    const s = b.schedule as Record<string, unknown>;
    const schedule: BlockSchedule = {};
    if (typeof s.from === 'number' && Number.isFinite(s.from)) schedule.from = s.from;
    if (typeof s.until === 'number' && Number.isFinite(s.until)) schedule.until = s.until;
    if (schedule.from !== undefined && schedule.until !== undefined && schedule.until <= schedule.from) {
      errors.push(`block ${blockId}: schedule ends before it starts; ignored`);
    } else if (Object.keys(schedule).length) {
      base.schedule = schedule;
    }
  }

  switch (b.type) {
    case 'link': {
      const label = str(b.label, MAX_LABEL_LENGTH);
      const href = b.href === undefined ? undefined : safeHttpUrl(String(b.href)) ?? undefined;
      const linkId = typeof b.linkId === 'string' && /^[0-9a-f-]{36}$/i.test(b.linkId) ? b.linkId : undefined;
      if (b.href !== undefined && !href) errors.push(`block ${blockId}: unsafe href dropped`);
      if (!label && !linkId) {
        errors.push(`block ${blockId}: link needs a label or a link id`);
        return null;
      }
      const block: LinkBlock = { ...base, type: 'link', label };
      if (href) block.href = href;
      if (linkId) block.linkId = linkId;
      const description = str(b.description, MAX_LABEL_LENGTH * 2);
      if (description) block.description = description;
      const thumb = b.thumbnailUrl === undefined ? undefined : safeHttpUrl(String(b.thumbnailUrl)) ?? undefined;
      if (thumb) block.thumbnailUrl = thumb;
      return block;
    }

    case 'text': {
      const text = str(b.text, MAX_TEXT_LENGTH);
      if (!text) {
        errors.push(`block ${blockId}: empty text dropped`);
        return null;
      }
      const style = b.style === 'heading' ? 'heading' : 'body';
      return { ...base, type: 'text', text, style };
    }

    case 'image': {
      const url = safeHttpUrl(String(b.url ?? ''));
      if (!url) {
        errors.push(`block ${blockId}: image needs a valid http(s) url`);
        return null;
      }
      const block: ImageBlock = { ...base, type: 'image', url, alt: str(b.alt, MAX_LABEL_LENGTH) };
      if (typeof b.width === 'number' && b.width > 0 && b.width <= 2000) block.width = Math.round(b.width);
      if (typeof b.height === 'number' && b.height > 0 && b.height <= 2000) block.height = Math.round(b.height);
      const href = b.href === undefined ? undefined : safeHttpUrl(String(b.href)) ?? undefined;
      if (href) block.href = href;
      const title = str(b.title, MAX_LABEL_LENGTH);
      if (title) block.title = title;
      return block;
    }

    case 'image_grid':
    case 'image_carousel': {
      const images = parseImages(b.images, blockId, errors);
      if (!images.length) {
        errors.push(`block ${blockId}: ${b.type} needs at least one image`);
        return null;
      }
      return { ...base, type: b.type, images };
    }

    case 'youtube': {
      const id = extractYoutubeId(String(b.videoId ?? ''));
      if (!id) {
        errors.push(`block ${blockId}: could not read a youtube id`);
        return null;
      }
      const block: YoutubeBlock = { ...base, type: 'youtube', videoId: id };
      const title = str(b.title, MAX_LABEL_LENGTH);
      if (title) block.title = title;
      if (typeof b.startAt === 'number' && b.startAt >= 0 && b.startAt <= 36000) block.startAt = Math.round(b.startAt);
      return block;
    }

    case 'contact': {
      const block: ContactBlock = {
        ...base,
        type: 'contact',
        showEmail: b.showEmail !== false,
        showPhone: b.showPhone === true,
        allowDownload: b.allowDownload !== false
      };
      const label = str(b.label, MAX_LABEL_LENGTH);
      if (label) block.label = label;
      return block;
    }

    case 'social': {
      const networks: Array<{ network: SocialNetwork; href: string }> = [];
      if (Array.isArray(b.networks)) {
        for (const entry of b.networks) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const e = entry as Record<string, unknown>;
          if (!SOCIAL_NETWORKS.includes(e.network as SocialNetwork)) continue;
          const href = safeHttpUrl(String(e.href ?? ''));
          if (!href) continue;
          networks.push({ network: e.network as SocialNetwork, href });
        }
      }
      if (!networks.length) {
        errors.push(`block ${blockId}: social needs at least one valid network`);
        return null;
      }
      return { ...base, type: 'social', networks };
    }

    default:
      errors.push(`unknown block type ${String(b.type)}`);
      return null;
  }
}

function parseImages(
  input: unknown,
  blockId: string,
  errors: string[]
): Array<{ url: string; alt: string; href?: string }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ url: string; alt: string; href?: string }> = [];
  for (const entry of input) {
    if (out.length >= MAX_IMAGES_PER_PAGE) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const url = safeHttpUrl(String(e.url ?? ''));
    if (!url) continue;
    const item: { url: string; alt: string; href?: string } = {
      url,
      alt: str(e.alt, MAX_LABEL_LENGTH)
    };
    const href = e.href === undefined ? undefined : safeHttpUrl(String(e.href)) ?? undefined;
    if (href) item.href = href;
    out.push(item);
  }
  if (input.length > out.length) {
    errors.push(`block ${blockId}: some images were dropped as invalid or over the ${MAX_IMAGES_PER_PAGE} image limit`);
  }
  return out;
}

function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Is the block inside its scheduling window at `now`? */
export function isBlockVisible(block: PageBlock, now = Date.now()): boolean {
  if (block.disabled) return false;
  if (!block.schedule) return true;
  if (block.schedule.from !== undefined && now < block.schedule.from) return false;
  if (block.schedule.until !== undefined && now >= block.schedule.until) return false;
  return true;
}

/**
 * Blocks a public visitor should see: visible ones, pinned first, then by
 * position, then by id so ordering is stable across renders.
 */
export function visibleBlocks(
  blocks: PageBlock[],
  now = Date.now()
): PageBlock[] {
  return blocks
    .filter((b) => isBlockVisible(b, now))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.position !== b.position) return a.position - b.position;
      return a.blockId.localeCompare(b.blockId);
    });
}

/** Total images a page would render, for the spec's 100-image cap. */
export function countImages(blocks: PageBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.type === 'image') n += 1;
    else if (b.type === 'image_grid' || b.type === 'image_carousel') n += b.images.length;
  }
  return n;
}