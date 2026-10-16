/**
 * Campaign and channel listing for the campaigns screen.
 *
 * Lives in lib/ rather than the page component because computing a date window
 * requires reading the clock, and the React compiler rules forbid doing that in
 * a component body. It is also the shape the rest of the project uses: the page
 * fetches a view model and renders it, nothing else.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';

export interface ChannelStat {
  id: string;
  name: string;
  utm_medium: string;
  link_count: number;
  clicks: number;
}

export interface CampaignWithChannels {
  id: string;
  name: string;
  description: string;
  created_at: string;
  channels: ChannelStat[];
}

export interface CampaignListing {
  campaigns: CampaignWithChannels[];
  totalClicks: number;
  windowDays: number;
}

export async function loadCampaigns(
  ownerId: string,
  options: { windowDays?: number; now?: number } = {}
): Promise<CampaignListing> {
  const windowDays = options.windowDays ?? 30;
  const now = options.now ?? Date.now();
  const from = new Date(now - windowDays * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);

  const supabase = getServiceSupabase();

  const { data: campaignRows } = await supabase
    .from('campaigns')
    .select('id,name,description,created_at')
    .eq('created_by', ownerId)
    .eq('archived', false)
    .order('created_at', { ascending: false });

  const campaigns = (campaignRows ?? []) as Array<{
    id: string;
    name: string;
    description: string;
    created_at: string;
  }>;

  const withChannels = await Promise.all(
    campaigns.map(async (c) => {
      const [channelsRes, engagementRes] = await Promise.all([
        supabase
          .from('channels')
          .select('id,name,utm_medium')
          .eq('campaign_id', c.id)
          .eq('archived', false)
          .order('name'),
        supabase.rpc('channel_engagement', {
          p_campaign_id: c.id,
          p_from: from,
          p_to: to
        })
      ]);

      const channels = (channelsRes.data ?? []) as Array<{
        id: string;
        name: string;
        utm_medium: string;
      }>;

      // channel_engagement returns one row per channel *per day*, so the
      // per-channel totals have to be summed before they can be compared.
      const rollup = new Map<string, { links: number; clicks: number }>();
      for (const row of (engagementRes.data ?? []) as Array<{
        channel_id: string;
        link_count: number | string;
        clicks: number | string;
      }>) {
        const prev = rollup.get(row.channel_id) ?? { links: 0, clicks: 0 };
        rollup.set(row.channel_id, {
          links: prev.links + Number(row.link_count ?? 0),
          clicks: prev.clicks + Number(row.clicks ?? 0)
        });
      }

      return {
        ...c,
        channels: channels.map((ch) => ({
          ...ch,
          link_count: rollup.get(ch.id)?.links ?? 0,
          clicks: rollup.get(ch.id)?.clicks ?? 0
        }))
      };
    })
  );

  const totalClicks = withChannels.reduce(
    (n, c) => n + c.channels.reduce((m, ch) => m + ch.clicks, 0),
    0
  );

  return { campaigns: withChannels, totalClicks, windowDays };
}