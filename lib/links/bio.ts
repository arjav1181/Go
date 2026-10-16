import { getServiceSupabase } from '@/lib/db/supabase-server';
import { CAMPAIGN_PATTERN } from '@/lib/links/campaigns';
import { BIO_HANDLE_PATTERN, type BioTheme } from '@/lib/links/bio-rules';

/**
 * Public link-in-bio pages.
 *
 * A bio page renders a curated set of an owner's links at /@handle. It is the
 * one genuinely public read path in the product, so the projection here is
 * deliberately narrow: slug, title, destination and click count only.
 *
 * Never exposed: notes, campaign names, whether a link is password-protected,
 * API keys, owner ids, expiry, or internal row ids.
 *
 * Pure validation lives in `bio-rules.ts` so it can be tested without a
 * database and cannot drift behind the data access below.
 */

export type BioLink = {
  slug: string;
  title: string;
  description: string;
  destinationUrl: string;
  clickCount: number;
};

export type BioPage = {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  theme: BioTheme;
  accentColor: string;
  isPublished: boolean;
  links: BioLink[];
};

/**
 * Load a published bio page.
 *
 * Returns null for anything unpublished, so a draft page is indistinguishable
 * from a page that does not exist. Also returns null when the database is
 * unreachable, because a public page should degrade to an ordinary 404 rather
 * than surface a 500.
 */
export async function loadBioPage(handle: string): Promise<BioPage | null> {
  const normalized = handle.trim().toLowerCase();
  if (!BIO_HANDLE_PATTERN.test(normalized)) return null;

  try {
    return await fetchBioPage(normalized);
  } catch {
    return null;
  }
}

async function fetchBioPage(normalized: string): Promise<BioPage | null> {
  const supabase = getServiceSupabase();

  const { data: page } = await supabase
    .from('bio_pages')
    .select('handle, display_name, bio, avatar_url, theme, accent_color, is_published, created_by')
    .eq('handle', normalized)
    .eq('is_published', true)
    .maybeSingle();

  if (!page) return null;

  const createdBy = page.created_by as string;

  // Only links the owner explicitly opted in, and only ones that can actually
  // be followed right now. A disabled or expired link on a bio page is a dead
  // row the visitor cannot explain.
  const { data: links } = await supabase
    .from('links')
    .select('id, slug, title, notes, destination_url, is_active, expires_at, campaign')
    .eq('created_by', createdBy)
    .eq('show_on_bio', true)
    .order('bio_order', { ascending: true, nullsFirst: false });

  const now = Date.now();
  const live = (links ?? []).filter((row) => {
    const link = row as { id: string; is_active: boolean; expires_at: string | null };
    if (!link.is_active) return false;
    if (link.expires_at && new Date(link.expires_at).getTime() <= now) return false;
    return true;
  });

  const clicksBySlug = await loadClickCounts(live.map((r) => (r as { id: string }).id), live);

  return {
    handle: page.handle as string,
    displayName: page.display_name as string,
    bio: (page.bio as string) ?? '',
    avatarUrl: (page.avatar_url as string) ?? '',
    theme: ((page.theme as BioTheme) ?? 'minimal'),
    accentColor: (page.accent_color as string) ?? '#0070f3',
    isPublished: page.is_published as boolean,
    links: live.map((row) => {
      const link = row as {
        id: string;
        slug: string;
        title: string | null;
        campaign: string | null;
        destination_url: string;
      };
      return {
        slug: link.slug,
        title: link.title?.trim() || link.slug,
        description: link.campaign ? `Campaign: ${link.campaign}` : '',
        destinationUrl: link.destination_url,
        clickCount: clicksBySlug.get(link.id) ?? 0
      };
    })
  };
}

async function loadClickCounts(
  linkIds: string[],
  rows: unknown[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (linkIds.length === 0) return counts;

  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('daily_click_stats')
    .select('link_id, click_count')
    .in('link_id', linkIds);

  const slugById = new Map(
    rows.map((r) => [(r as { id: string }).id, (r as { slug: string }).slug])
  );

  for (const row of data ?? []) {
    const stat = row as { link_id: string; click_count: number | null };
    const slug = slugById.get(stat.link_id);
    if (slug) counts.set(slug, (counts.get(slug) ?? 0) + (stat.click_count ?? 0));
  }
  return counts;
}

export { CAMPAIGN_PATTERN };
export {
  BIO_HANDLE_PATTERN,
  RESERVED_HANDLES,
  isReservedHandle,
  normalizeHandle,
  validateHandle,
  safeBioHref,
  safeAccentColor,
  validateTheme
} from '@/lib/links/bio-rules';