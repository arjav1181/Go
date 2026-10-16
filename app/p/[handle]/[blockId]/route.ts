import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { recordBlockClick } from '@/lib/pages/analytics';
import { recordClick } from '@/lib/analytics/record-click';
import { isPubliclyVisible, type PageRow } from '@/lib/pages/lifecycle';
import { parseBlocks } from '@/lib/pages/blocks';
import { normalizeHandle } from '@/lib/links/bio-rules';

type Params = { params: Promise<{ handle: string; blockId: string }> };

export const dynamic = 'force-dynamic';

/**
 * GET /p/{handle}/{blockId}?to={url}
 *
 * Records a click on a page block, then redirects to the block's destination.
 *
 * Why a redirect endpoint instead of a client-side beacon
 * ------------------------------------------------------
 * A beacon fired from the page depends on JavaScript running, which ad blockers
 * and privacy settings routinely prevent — so a beacon-based CTR is measured
 * against a fraction of visitors and quietly under-reports. Counting here, on
 * the server, before the redirect, is exact and works with scripting disabled.
 *
 * `to` is validated before use. This endpoint takes a URL from the query string
 * and redirects to it, which is precisely an open-redirect shape; without the
 * http(s) check any third party could mint a link on the owner's page that
 * forwards to an arbitrary destination under their domain's reputation.
 */
export async function GET(request: Request, { params }: Params) {
  const { handle, blockId } = await params;

  const destination = new URL(request.url).searchParams.get('to');
  const target = destination ? safeHttp(destination) : null;

  if (!target) {
    return new NextResponse('Not found', { status: 404 });
  }

  const normalized = normalizeHandle(handle);
  if (!normalized) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('bio_pages')
    .select('id,kind,handle,slug,is_published,draft_blocks,published_blocks,scheduled_publish_at,scheduled_unpublish_at,published_at')
    .eq('handle', normalized)
    .maybeSingle();

  const page = data as unknown as PageRow | null;

  // Only count against a page a visitor could actually see.
  if (page && isPubliclyVisible(page)) {
    after(() => recordBlockClick(page.id, blockId));

    // When the block points at a managed link, that link's own analytics should
    // record the click too, so a page-driven visit shows up in link detail as
    // well as in page analytics.
    const linkId = linkIdForBlock(page, blockId);
    if (linkId) {
      after(() =>
        recordClick({
          linkId,
          referrer: request.headers.get('referer') ?? null,
          userAgent: request.headers.get('user-agent'),
          campaign: 'Bitly Link-in-bio'
        })
      );
    }
  }

  return NextResponse.redirect(target, {
    status: 302,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

/**
 * Does this block resolve to a managed link?
 *
 * Only the live document is consulted, so a click cannot be attributed to a
 * block that has been removed from the page.
 */
function linkIdForBlock(page: PageRow, blockId: string): string | null {
  if (page.published_blocks === null) return null;
  const parsed = parseBlocks(page.published_blocks);
  const block = parsed.blocks.find((b) => b.blockId === blockId);
  if (!block || block.type !== 'link') return null;
  return block.linkId ?? null;
}

function safeHttp(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}