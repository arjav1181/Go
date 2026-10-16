/**
 * Page view and block-click recording.
 *
 * The spec (section 07, Page analytics) reports page views and link clicks
 * separately and derives a click-through rate from the two, plus contact
 * downloads. So a view increments `page_daily_stats` and a block click increments
 * `page_block_daily_stats`, and the panel divides one by the other.
 *
 * Referrer attribution: a click that starts on a published page should appear in
 * link analytics the way Bitly reports it — as "Bitly Link-in-bio". That is done
 * by the redirect route, not here, because the redirect is what has the link id.
 * This module only owns the page-side counters.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';

const SCAN_REFERRER = 'Bitly QR Code';
const PAGE_REFERRER = 'Bitly Link-in-bio';

export { SCAN_REFERRER, PAGE_REFERRER };

/**
 * Record one page view.
 *
 * Fire-and-forget by design: a visitor's page must render even if the counter
 * fails, and the failure path must not leak anything about the database.
 */
export async function recordPageView(pageId: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const supabase = getServiceSupabase();
    await supabase.rpc('increment_page_view', {
      p_page_id: pageId,
      p_day: day
    });
  } catch {
    // Analytics must never break a public page.
  }
}

/** Record one click on a block, including contact downloads. */
export async function recordBlockClick(pageId: string, blockId: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const supabase = getServiceSupabase();
    await supabase.rpc('increment_block_click', {
      p_page_id: pageId,
      p_block_id: blockId,
      p_day: day
    });
  } catch {
    // Same: never break navigation.
  }
}

export interface PageStats {
  views: number;
  clicks: number;
  /** Clicks per view, or null when there is nothing to divide. */
  clickThroughRate: number | null;
}

export async function loadPageStats(pageId: string, days: number): Promise<PageStats> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  try {
    const supabase = getServiceSupabase();
    const [views, clicks] = await Promise.all([
      supabase
        .from('page_daily_stats')
        .select('views')
        .eq('page_id', pageId)
        .gte('day', since),
      supabase
        .from('page_block_daily_stats')
        .select('clicks')
        .eq('page_id', pageId)
        .gte('day', since)
    ]);

    const viewTotal = (views.data ?? []).reduce((n, r) => n + Number(r.views ?? 0), 0);
    const clickTotal = (clicks.data ?? []).reduce((n, r) => n + Number(r.clicks ?? 0), 0);

    return {
      views: viewTotal,
      clicks: clickTotal,
      clickThroughRate: viewTotal > 0 ? clickTotal / viewTotal : null
    };
  } catch {
    return { views: 0, clicks: 0, clickThroughRate: null };
  }
}

export interface BlockRow {
  block_id: string;
  clicks: number;
}

/** Per-block totals for the editor's performance list. */
export async function loadBlockStats(pageId: string, days: number): Promise<BlockRow[]> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  try {
    const supabase = getServiceSupabase();
    const { data } = await supabase
      .from('page_block_daily_stats')
      .select('block_id,clicks')
      .eq('page_id', pageId)
      .gte('day', since);

    const totals = new Map<string, number>();
    for (const row of data ?? []) {
      const id = (row as { block_id: string }).block_id;
      totals.set(id, (totals.get(id) ?? 0) + Number((row as { clicks: number }).clicks ?? 0));
    }
    return [...totals.entries()]
      .map(([block_id, clicks]) => ({ block_id, clicks }))
      .sort((a, b) => b.clicks - a.clicks);
  } catch {
    return [];
  }
}