import { NextResponse } from 'next/server';
import { getOwnerOrNull } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { resolveRange, previousPeriod, eachDay } from '@/lib/analytics/range';
import { toCsv } from '@/lib/csv';
import { claimUnownedLinks } from '@/lib/links/ownership';
import { checkRateLimit, policyFor, callerKeyFromHeaders } from '@/lib/ratelimit/limiter';
import { logEvent, EVENTS } from '@/lib/log';

export const dynamic = 'force-dynamic';

type Format = 'granular' | 'daily';

function pickFormat(value: string | null): Format {
  return value === 'daily' ? 'daily' : 'granular';
}

/**
 * Owner-only CSV export of aggregate click statistics.
 *
 * Deliberately excludes private notes and owner ids: exported columns are
 * limited to link identity, day, and the same coarse dimensions that are
 * stored (referrer hostname, device category).
 */
export async function GET(request: Request) {
  const owner = await getOwnerOrNull();
  if (!owner) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const limit = await checkRateLimit(
    policyFor('export', callerKeyFromHeaders(request.headers))
  );
  if (!limit.allowed) {
    logEvent(EVENTS.exportRateLimited, 'warn', {});
    return new NextResponse('Too many exports. Try again shortly.', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) }
    });
  }

  const params = new URL(request.url).searchParams;
  const preset = params.get('range') ?? '30d';
  const format = pickFormat(params.get('format'));
  const range = resolveRange(preset, params.get('start') ?? undefined, params.get('end') ?? undefined);
  const previous = previousPeriod(range);

  const supabase = getServiceSupabase();

  // Adopt links created before owner tracking so exports are complete.
  await claimUnownedLinks(owner.id);

  // Only links owned by this requester may be exported.
  const { data: links } = await supabase
    .from('links')
    .select('id, slug, title')
    .eq('created_by', owner.id);

  const owned = (links ?? []) as Array<{ id: string; slug: string; title: string | null }>;
  const ownedIds = owned.map((link) => link.id);

  if (ownedIds.length === 0) {
    return csvResponse(
      toCsv(
        ['day', 'slug', 'title', 'referrer_host', 'device_category', 'clicks'],
        []
      ),
      range,
      previous,
      format
    );
  }

  const { data: rows } = await supabase
    .from('daily_click_stats')
    .select('day, link_id, referrer_host, device_category, click_count')
    .in('link_id', ownedIds)
    .gte('day', previous.start)
    .lte('day', range.end)
    .order('day', { ascending: true });

  const linkById = new Map(owned.map((link) => [link.id, link]));

  if (format === 'daily') {
    // One row per link per day, dimensions rolled up.
    const totals = new Map<string, number>();
    for (const row of rows ?? []) {
      const key = `${row.day}|${row.link_id}`;
      totals.set(key, (totals.get(key) ?? 0) + Number(row.click_count));
    }

    const body: Array<Array<string | number>> = [];
    for (const day of eachDay(range)) {
      for (const link of owned) {
        const clicks = totals.get(`${day}|${link.id}`) ?? 0;
        body.push([day, link.slug, link.title ?? '', clicks]);
      }
    }

    return csvResponse(
      toCsv(['day_utc', 'slug', 'title', 'clicks'], body),
      range,
      previous,
      format
    );
  }

  const body: Array<Array<string | number>> = [];
  for (const row of rows ?? []) {
    if (row.day < range.start || row.day > range.end) continue;
    const link = linkById.get(row.link_id);
    if (!link) continue;
    body.push([row.day, link.slug, link.title ?? '', row.referrer_host, row.device_category, Number(row.click_count)]);
  }

  return csvResponse(
    toCsv(['day_utc', 'slug', 'title', 'referrer_host', 'device_category', 'clicks'], body),
    range,
    previous,
    format
  );
}

function csvResponse(
  csv: string,
  range: { start: string; end: string },
  previous: { start: string; end: string },
  format: Format
): NextResponse {
  const stamp = `${range.start}_to_${range.end}`;
  const filename = `go-clicks_${format}_${stamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      // Human-readable provenance for whoever opens the file.
      'X-Click-Range': `${range.start}..${range.end}`,
      'X-Previous-Range': `${previous.start}..${previous.end}`
    }
  });
}