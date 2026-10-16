/**
 * Page templates (spec sheet section 07, "Step 3 — Select template").
 *
 * A template is just a starting block list plus theme hints. Nothing here is
 * stored as a template row: seeding from one is a pure function, so adding a
 * template is a code change rather than a migration, and a template can never
 * drift from the block schema the way a persisted preset can.
 */

import type { PageBlock, BlockType } from './blocks';
import { BIO_THEMES, type BioTheme } from '../links/bio-rules';

export interface PageTemplate {
  id: string;
  name: string;
  /** Grouped in the picker, matching the spec's use-case categories. */
  category: 'bio' | 'product' | 'promotion';
  description: string;
  theme: BioTheme;
  /** Ordered block types the template starts with. */
  shape: Array<{ type: BlockType; label: string }>;
}

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: 'bio',
    name: 'Link in bio',
    category: 'bio',
    description: 'Profile header, social icons and a stack of links.',
    theme: 'card',
    shape: [
      { type: 'social', label: 'Social icons' },
      { type: 'text', label: 'About me' },
      { type: 'link', label: 'Featured link' }
    ]
  },
  {
    id: 'product',
    name: 'Product or service',
    category: 'product',
    description: 'Hero image, description, links and a contact card.',
    theme: 'minimal',
    shape: [
      { type: 'image', label: 'Hero image' },
      { type: 'text', label: 'Description' },
      { type: 'link', label: 'Get started' },
      { type: 'contact', label: 'Contact details' }
    ]
  },
  {
    id: 'gallery',
    name: 'Image gallery',
    category: 'product',
    description: 'A swipeable carousel or grid of images.',
    theme: 'grid',
    shape: [
      { type: 'text', label: 'Heading' },
      { type: 'image_carousel', label: 'Carousel' }
    ]
  },
  {
    id: 'promotion',
    name: 'Promotion',
    category: 'promotion',
    description: 'Time-limited links with a video and a call to action.',
    theme: 'card',
    shape: [
      { type: 'heading_or_youtube' as BlockType, label: 'Video' },
      { type: 'text', label: 'Offer details' },
      { type: 'link', label: 'Claim offer' }
    ]
  },
  {
    id: 'blank',
    name: 'Blank page',
    category: 'product',
    description: 'Start from nothing.',
    theme: 'minimal',
    shape: []
  }
];

export function findTemplate(id: string): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Build the starting block list for a template.
 *
 * Each entry gets a fresh uuid and a position spaced by 10 so an editor can
 * insert between blocks without renumbering. The content is left empty because
 * there is no truthful default for someone's link or product image — the editor
 * fills those in, and an image block with no url is rejected by `parseBlocks`.
 */
export function seedBlocks(templateId: string): PageBlock[] {
  const template = findTemplate(templateId);
  if (!template) return [];

  const blocks: PageBlock[] = template.shape.map((entry, index) => {
    const base = {
      blockId: crypto.randomUUID(),
      position: index * 10,
      pinned: index === 0 && entry.type !== 'social'
    };
    switch (entry.type) {
      case 'link':
        return { ...base, type: 'link', label: entry.label };
      case 'text':
        return { ...base, type: 'text', text: '', style: index === 0 ? 'heading' : 'body' };
      case 'image':
        return { ...base, type: 'image', url: '', alt: '' };
      case 'image_carousel':
      case 'image_grid':
        return { ...base, type: entry.type, images: [] };
      case 'youtube':
        return { ...base, type: 'youtube', videoId: '' };
      case 'contact':
        return { ...base, type: 'contact', showEmail: true, showPhone: false, allowDownload: true };
      case 'social':
        return { ...base, type: 'social', networks: [] };
      default:
        // 'heading_or_youtube' is a template affordance, not a real type.
        return { ...base, type: 'youtube', videoId: '' };
    }
  });

  // Drop the placeholders that cannot render yet; the editor adds real ones.
  return blocks.filter((b) => {
    if (b.type === 'text') return b.text.length > 0;
    if (b.type === 'image') return b.url.length > 0;
    if (b.type === 'image_grid' || b.type === 'image_carousel') return b.images.length > 0;
    if (b.type === 'youtube') return b.videoId.length > 0;
    if (b.type === 'social') return b.networks.length > 0;
    return true;
  });
}

/**
 * The DB constrains `bio_pages.theme` to ('minimal','card','grid') via
 * `bio_pages_theme_valid`, so these are the only themes a template may name.
 * Widening the set needs a migration before it can be offered.
 */
export { BIO_THEMES };
export type { BioTheme };