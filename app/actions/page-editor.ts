'use server';

import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { preparePublish, prepareSave, draftBlocks, hasUnpublishedChanges, type PageRow } from '@/lib/pages/lifecycle';
import { loadPageStats, loadBlockStats, type PageStats } from '@/lib/pages/analytics';
import { seedBlocks, findTemplate, PAGE_TEMPLATES } from '@/lib/pages/templates';
import { parseBlocks, countImages, MAX_IMAGES_PER_PAGE } from '@/lib/pages/blocks';

export interface PageEditorResult {
  ok: boolean;
  error?: string;
  warnings?: string[];
  hasUnpublishedChanges?: boolean;
}

/**
 * Load the owner's page for editing.
 *
 * Returns null when no page exists yet; the settings screen then offers a
 * template picker instead of an empty editor.
 */
export async function loadPageForEditor(): Promise<{
  page: PageRow | null;
  blocks: unknown[];
  stats: PageStats;
  blockStats: Record<string, number>;
  handle: string;
  templates: typeof PAGE_TEMPLATES;
} | null> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { data } = await supabase
    .from('bio_pages')
    .select(
      'id,kind,handle,slug,is_published,draft_blocks,published_blocks,scheduled_publish_at,scheduled_unpublish_at,published_at'
    )
    .eq('created_by', owner.id)
    .maybeSingle();

  const row = data as unknown as PageRow | null;
  const stats = row ? await loadPageStats(row.id, 30) : { views: 0, clicks: 0, clickThroughRate: null };
  const blockRows = row ? await loadBlockStats(row.id, 30) : [];
  const blockStats: Record<string, number> = {};
  for (const b of blockRows) blockStats[b.block_id] = b.clicks;

  return {
    page: row,
    blocks: row ? draftBlocks(row) : [],
    stats,
    blockStats,
    handle: row?.handle ?? '',
    templates: PAGE_TEMPLATES
  };
}

/**
 * Create the page if it does not exist, optionally seeding from a template.
 */
export async function ensurePage(templateId = 'blank'): Promise<PageEditorResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { data: existing } = await supabase
    .from('bio_pages')
    .select('id')
    .eq('created_by', owner.id)
    .maybeSingle();

  if (existing) return { ok: true };

  const template = findTemplate(templateId);
  if (!template) return { ok: false, error: 'Unknown template.' };

  const blocks = seedBlocks(templateId);
  const parsed = parseBlocks(blocks);

  const { error } = await supabase.from('bio_pages').insert({
    created_by: owner.id,
    kind: 'bio',
    handle: 'change-me',
    display_name: 'Your name',
    bio: '',
    avatar_url: '',
    theme: template.theme,
    accent_color: '#0070f3',
    is_published: false,
    draft_blocks: parsed.blocks,
    published_blocks: null
  });

  if (error) return { ok: false, error: 'Unable to create the page.' };
  return { ok: true };
}

/**
 * Save the draft without publishing.
 *
 * The spec is explicit that leaving the editor must not discard the draft and
 * that changes do not go live until Publish is pressed, so this writes only
 * `draft_blocks` and the schedule.
 */
export async function savePageDraft(input: {
  draft_blocks: unknown;
  scheduled_publish_at?: string | null;
  scheduled_unpublish_at?: string | null;
}): Promise<PageEditorResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  // published_blocks is needed to tell whether the draft is ahead of what is
  // live; without it the badge would always read "unpublished changes".
  const { data: row } = await supabase
    .from('bio_pages')
    .select('id,is_published,draft_blocks,published_blocks')
    .eq('created_by', owner.id)
    .maybeSingle();

  if (!row) return { ok: false, error: 'No page to save.' };

  const parsed = parseBlocks(input.draft_blocks);
  const images = countImages(parsed.blocks);

  const { patch } = prepareSave(parsed.blocks, {
    scheduledPublishAt: input.scheduled_publish_at ?? null,
    scheduledUnpublishAt: input.scheduled_unpublish_at ?? null,
    wasPublished: (row as { is_published: boolean }).is_published
  });

  const { error } = await supabase
    .from('bio_pages')
    .update({ ...patch, draft_blocks: parsed.blocks })
    .eq('id', (row as { id: string }).id)
    .eq('created_by', owner.id);

  if (error) return { ok: false, error: 'Unable to save the draft.' };

  const warnings = [...parsed.errors];
  if (images > MAX_IMAGES_PER_PAGE) {
    warnings.push(`${images} images exceeds the ${MAX_IMAGES_PER_PAGE}-image limit.`);
  }

  return {
    ok: true,
    warnings: warnings.length ? warnings : undefined,
    hasUnpublishedChanges: hasUnpublishedChanges({
      ...(row as unknown as PageRow),
      draft_blocks: parsed.blocks
    })
  };
}

/** Copy the draft into the published document. */
export async function publishPage(): Promise<PageEditorResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { data: row } = await supabase
    .from('bio_pages')
    .select('*')
    .eq('created_by', owner.id)
    .maybeSingle();

  if (!row) return { ok: false, error: 'No page to publish.' };

  const full = row as unknown as PageRow;
  const draft = (row as { draft_blocks: unknown }).draft_blocks;
  const { patch, errors } = preparePublish(draft);

  if (patch.published_blocks === undefined) {
    return { ok: false, error: 'Nothing to publish.' };
  }

  const { error } = await supabase
    .from('bio_pages')
    .update(patch)
    .eq('id', full.id)
    .eq('created_by', owner.id);

  if (error) return { ok: false, error: 'Unable to publish.' };

  return {
    ok: true,
    warnings: errors.length ? errors : undefined,
    hasUnpublishedChanges: false
  };
}

/** Unpublish without losing the published document. */
export async function unpublishPage(): Promise<PageEditorResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from('bio_pages')
    .update({ is_published: false })
    .eq('created_by', owner.id);

  if (error) return { ok: false, error: 'Unable to unpublish.' };
  return { ok: true };
}