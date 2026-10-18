'use server';

import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';

export interface CampaignResult {
  ok: boolean;
  error?: string;
}

const NAME_MAX = 80;
const UTM_MEDIUM_MAX = 80;

/**
 * Create a campaign together with its first channel.
 *
 * Both in one action because the spec is explicit that a campaign must contain
 * at least one channel, and there is a trigger enforcing it — creating an empty
 * campaign would be rejected by the database rather than by a helpful message.
 */
export async function createCampaign(input: {
  name: string;
  description?: string;
  channelName: string;
  utmMedium?: string;
}): Promise<CampaignResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const name = input.name.trim();
  const channelName = input.channelName.trim();
  const medium = (input.utmMedium ?? '').trim() || 'go';

  if (!name) return { ok: false, error: 'Campaign name is required.' };
  if (name.length > NAME_MAX) return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };
  if (!channelName) return { ok: false, error: 'Add at least one channel — a campaign cannot be empty.' };
  if (channelName.length > NAME_MAX) {
    return { ok: false, error: `Keep the channel name under ${NAME_MAX} characters.` };
  }
  if (medium.length > UTM_MEDIUM_MAX) {
    return { ok: false, error: `Keep utm_medium under ${UTM_MEDIUM_MAX} characters.` };
  }

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .insert({
      created_by: owner.id,
      name,
      description: input.description?.trim().slice(0, 280) ?? ''
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'You already have a campaign with that name.' };
    }
    return { ok: false, error: 'Could not create the campaign.' };
  }

  const { error: channelError } = await supabase.from('channels').insert({
    campaign_id: campaign.id,
    created_by: owner.id,
    name: channelName,
    utm_medium: medium
  });

  if (channelError) {
    /**
     * Roll the campaign back rather than leaving an empty one behind. The
     * trigger would normally stop this, but the campaign row already exists at
     * this point and a half-created campaign is worse than none.
     */
    await supabase.from('campaigns').delete().eq('id', campaign.id).eq('created_by', owner.id);
    if (channelError.code === '23505') {
      return { ok: false, error: 'That channel name is already used in this campaign.' };
    }
    if (channelError.message?.includes('CHANNEL_LIMIT')) {
      return { ok: false, error: 'You have reached the channel limit for this account.' };
    }
    return { ok: false, error: 'The campaign was created but its channel could not be.' };
  }

  return { ok: true };
}

/** Add a channel to an existing campaign. */
export async function addChannel(input: {
  campaignId: string;
  name: string;
  utmMedium?: string;
}): Promise<CampaignResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Channel name is required.' };
  if (name.length > NAME_MAX) return { ok: false, error: `Keep it under ${NAME_MAX} characters.` };

  // Ownership is proven by the query rather than trusted from the id.
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', input.campaignId)
    .eq('created_by', owner.id)
    .maybeSingle();

  if (!campaign) return { ok: false, error: 'Campaign not found.' };

  const { error } = await supabase.from('channels').insert({
    campaign_id: input.campaignId,
    created_by: owner.id,
    name,
    utm_medium: (input.utmMedium ?? '').trim() || 'go'
  });

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That channel already exists.' };
    if (error.message?.includes('CHANNEL_LIMIT_PER_CAMPAIGN')) {
      return { ok: false, error: 'This campaign has reached its 100-channel limit.' };
    }
    if (error.message?.includes('CHANNEL_LIMIT_PER_ACCOUNT')) {
      return { ok: false, error: 'This account has reached its 500-channel limit.' };
    }
    return { ok: false, error: 'Could not add the channel.' };
  }

  return { ok: true };
}

/**
 * Archive a channel.
 *
 * A campaign cannot be left without one — there is a trigger for it — so the
 * case where this would strand the campaign is reported rather than surfacing as
 * a database error.
 */
export async function archiveChannel(channelId: string): Promise<CampaignResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { data: channel } = await supabase
    .from('channels')
    .select('id, campaign_id')
    .eq('id', channelId)
    .eq('created_by', owner.id)
    .maybeSingle();

  if (!channel) return { ok: false, error: 'Channel not found.' };

  const { error } = await supabase
    .from('channels')
    .update({ archived: true })
    .eq('id', channelId);

  if (error) {
    if (error.message?.includes('CAMPAIGN_REQUIRES_CHANNEL')) {
      return {
        ok: false,
        error: 'This is the only active channel in its campaign. Archive the campaign first.'
      };
    }
    return { ok: false, error: 'Could not archive the channel.' };
  }

  return { ok: true };
}

/**
 * Preview the destination a campaign channel would produce.
 *
 * Shown in the UI before the link is created, because the tagged URL is what
 * actually lands in front of the recipient and getting it wrong is silent.
 */
export async function previewCampaignUrl(input: {
  destination: string;
  campaign: string;
  channel: string;
  medium?: string;
}): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const url = new URL(input.destination);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Destination must be an http(s) URL.' };
    }
  } catch {
    return { ok: false, error: 'Destination must be a valid URL.' };
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('build_campaign_url', {
    p_destination: input.destination,
    p_campaign: input.campaign,
    p_channel: input.channel,
    p_medium: (input.medium ?? '').trim() || 'go'
  });

  if (error) return { ok: false, error: 'Could not build the URL.' };
  return { ok: true, url: typeof data === 'string' ? data : input.destination };
}
