import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  isPubliclyVisible,
  publicBlocks,
  type PageRow
} from '@/lib/pages/lifecycle';
import { safeAccentColor, safeBioHref, normalizeHandle } from '@/lib/links/bio-rules';
import { recordPageView } from '@/lib/pages/analytics';
import { resolveBlockTargets, applyTargets } from '@/lib/pages/targets';
import { PageView, type PageLink } from '@/components/page-view';

type Params = { params: Promise<{ handle: string }> };

export const dynamic = 'force-dynamic';

/**
 * Resolve which row a public bio URL maps to.
 *
 * Returns null for unpublished, out-of-schedule, or missing pages so that a
 * draft is indistinguishable from a nonexistent one — the spec's behaviour, and
 * also the one that stops handle enumeration from leaking drafts.
 */
async function load(handle: string): Promise<PageRow | null> {
  const normalized = normalizeHandle(handle);
  if (!normalized) return null;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('bio_pages')
    .select(
      'id,kind,handle,slug,is_published,draft_blocks,published_blocks,scheduled_publish_at,scheduled_unpublish_at,published_at'
    )
    .eq('handle', normalized)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as PageRow;
  if (!isPubliclyVisible(row)) return null;
  return row;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const page = await load(handle);
  if (!page) return { title: 'Not found' };

  const { display_name, seo_title, seo_description, avatar_url } = await identity(page.id);

  const blockTitle = seo_title || display_name;
  const blockDescription = seo_description || blockTitle;

  return {
    title: blockTitle,
    description: blockDescription,
    alternates: { canonical: `/@${page.handle}` },
    openGraph: {
      title: blockTitle,
      description: blockDescription,
      ...(avatar_url && safeBioHref(avatar_url) ? { images: [avatar_url] } : {})
    },
    // A published page is meant to be shared and indexed.
    robots: { index: true, follow: true }
  };
}

async function identity(pageId: string) {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('bio_pages')
    .select('display_name,avatar_url,seo_title,seo_description,contact_name,contact_email,contact_phone')
    .eq('id', pageId)
    .maybeSingle();
  return (
    (data as Record<string, string> | null) ?? {
      display_name: '',
      avatar_url: '',
      seo_title: '',
      seo_description: '',
      contact_name: '',
      contact_email: '',
      contact_phone: ''
    }
  );
}

export default async function BioPageRoute({ params }: Params) {
  const { handle } = await params;
  const page = await load(handle);
  if (!page) notFound();

  const meta = await identity(page.id);
  const accent = await accentFor(page.id);

  /**
   * `null` means this page was created before blocks existed and has never been
   * published through the editor. It keeps the original fixed layout so nothing
   * that is already live goes blank after deploy.
   */
  const blocks = publicBlocks(page);

  if (blocks === null) {
    const legacy = await loadLegacy(page.id, page.handle as string);
    if (!legacy) notFound();
    return (
      <PageView
        handle={legacy.handle}
        displayName={legacy.displayName}
        bioText={legacy.bio}
        avatarUrl={legacy.avatarUrl}
        accentColor={accent}
        links={legacy.links}
        pageId={page.id}
      />
    );
  }

  await recordPageView(page.id);

  /**
   * Link-backed blocks carry a linkId, not a URL, so they need resolving before
   * they can be rendered. One batched query for the whole page rather than one
   * per block, on a path every visitor takes.
   */
  const targets = await resolveBlockTargets(blocks);
  const renderable = applyTargets(blocks, targets);

  return (
    <PageView
      handle={page.handle as string}
      displayName={meta.display_name}
      bioText={meta.seo_description}
      avatarUrl={meta.avatar_url}
      accentColor={accent}
      pageId={page.id}
      blocks={renderable}
      contact={{
        name: meta.contact_name,
        email: meta.contact_email,
        phone: meta.contact_phone
      }}
    />
  );
}

async function accentFor(pageId: string): Promise<string> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('bio_pages')
    .select('accent_color')
    .eq('id', pageId)
    .maybeSingle();
  const raw = (data as { accent_color?: string } | null)?.accent_color ?? '#0070f3';
  return safeAccentColor(raw) ?? '#0070f3';
}

async function loadLegacy(pageId: string, handle: string) {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('bio_pages')
    .select('display_name,bio,avatar_url')
    .eq('id', pageId)
    .maybeSingle();
  if (!data) return null;

  const { data: linkRows } = await supabase
    .from('links')
    .select('slug,title,notes,destination_url')
    .eq('show_on_bio', true)
    .eq('is_active', true)
    .eq('created_by', (data as { created_by?: string }).created_by ?? '')
    .order('bio_order', { ascending: true });

  const links: PageLink[] = (linkRows ?? [])
    .filter((l) => {
      const href = safeBioHref((l as { destination_url: string }).destination_url);
      return href !== null;
    })
    .map((l) => ({
      slug: (l as { slug: string }).slug,
      label: (l as { title?: string; slug: string }).title || (l as { slug: string }).slug,
      description: (l as { notes?: string }).notes ?? '',
      href: safeBioHref((l as { destination_url: string }).destination_url) as string
    }));

  return {
    handle,
    displayName: (data as { display_name: string }).display_name,
    bio: (data as { bio: string }).bio,
    avatarUrl: safeBioHref((data as { avatar_url: string }).avatar_url) ?? '',
    links
  };
}