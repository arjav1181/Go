import { authorizeApiRequest, apiError, apiJson } from '@/lib/api/auth';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { resolveRange, previousPeriod, eachDay } from '@/lib/analytics/range';
import { toDailySeries, toBreakdown, sumClicks } from '@/lib/analytics/compare';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/analytics — aggregate click statistics for the key's owner.
 *
 * Returns only the same coarse aggregates stored by the product: daily totals,
 * referrer hostname and device category. No per-visitor data exists to expose.
 */
export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'analytics:read');
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const range = resolveRange(
    params.get('range') ?? '30d',
    params.get('start') ?? undefined,
    params.get('end') ?? undefined
  );
  const previous = previousPeriod(range);

  try {
    const supabase = getServiceSupabase();

    const { data: links } = await supabase
      .from('links')
      .select('id, slug, title')
      .eq('created_by', auth.ownerId);

    const owned = (links ?? []) as Array<{ id: string; slug: string; title: string | null }>;
    const ids = owned.map((link) => link.id);
    const linkById = new Map(owned.map((link) => [link.id, link]));

    const { data: rows } = ids.length
      ? await supabase
          .from('daily_click_stats')
          .select('day, link_id, referrer_host, device_category, click_count')
          .in('link_id', ids)
          .gte('day', previous.start)
          .lte('day', range.end)
      : { data: [] as unknown[] };

    const all = (rows ?? []) as Array<{
      day: string;
      link_id: string;
      referrer_host: string;
      device_category: string;
      click_count: number | string;
    }>;

    const inRange = all.filter((row) => row.day >= range.start && row.day <= range.end);
    const inPrevious = all.filter((row) => row.day >= previous.start && row.day <= previous.end);

    return apiJson({
      range: { ...range, timezone: 'UTC' },
      previous_range: previous,
      total_clicks: sumClicks(inRange),
      previous_total_clicks: sumClicks(inPrevious),
      daily: toDailySeries(inRange, eachDay(range)),
      referrers: toBreakdown(inRange, 'referrer_host'),
      devices: toBreakdown(inRange, 'device_category'),
      by_link: ids.map((id) => {
        const link = linkById.get(id);
        return {
          id,
          slug: link?.slug ?? null,
          title: link?.title ?? null,
          clicks: sumClicks(inRange.filter((row) => row.link_id === id))
        };
      }),
      note: 'Counts are aggregate clicks, not unique visitors. No IP addresses or raw user agents are stored.'
    });
  } catch {
    return apiError('server_error', 'Unable to load analytics.');
  }
}