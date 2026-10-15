import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  normalizeRetention,
  DEFAULT_RETENTION_DAYS,
  type RetentionSettings
} from '@/lib/retention/retention';
import {
  normalizeAggregation,
  DEFAULT_AGGREGATION,
  type AggregationSettings
} from '@/lib/settings/aggregation';

export type OwnerSettings = {
  retention: RetentionSettings;
  aggregation: AggregationSettings;
};

/**
 * Defaults are used when no row exists yet.
 *
 * Retention is OFF, which means click history is never deleted unless the owner
 * turns it on. Both aggregation dimensions default to on.
 */
export const DEFAULT_OWNER_SETTINGS: OwnerSettings = {
  retention: { enabled: false, days: DEFAULT_RETENTION_DAYS },
  aggregation: DEFAULT_AGGREGATION
};

function fromRow(row: Record<string, unknown> | null): OwnerSettings {
  if (!row) return DEFAULT_OWNER_SETTINGS;
  return {
    retention: normalizeRetention({
      enabled: row.retention_enabled === true,
      days: typeof row.retention_days === 'number' ? row.retention_days : undefined
    }),
    aggregation: normalizeAggregation({
      track_referrer: row.track_referrer,
      track_device: row.track_device
    })
  };
}

export async function getOwnerSettings(ownerId: string): Promise<OwnerSettings> {
  try {
    const supabase = getServiceSupabase();
    const { data } = await supabase
      .from('owner_settings')
      .select('retention_enabled, retention_days, track_referrer, track_device')
      .eq('owner_id', ownerId)
      .maybeSingle();
    return fromRow(data as Record<string, unknown> | null);
  } catch {
    return DEFAULT_OWNER_SETTINGS;
  }
}

export async function saveOwnerSettings(ownerId: string, settings: OwnerSettings): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { error } = await supabase.from('owner_settings').upsert({
    owner_id: ownerId,
    retention_enabled: settings.retention.enabled,
    retention_days: settings.retention.days,
    track_referrer: settings.aggregation.track_referrer,
    track_device: settings.aggregation.track_device
  });
  return !error;
}

/**
 * Owner ids that have retention switched on.
 *
 * Used by the purge job to decide whose history to prune; owners with
 * retention disabled are never touched.
 */
export async function listRetentionEnabledOwners(): Promise<
  Array<{ ownerId: string; settings: RetentionSettings }>
> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('owner_settings')
    .select('owner_id, retention_enabled, retention_days')
    .eq('retention_enabled', true);

  if (error || !data) return [];

  return data
    .map((row) => ({
      ownerId: row.owner_id as string,
      settings: normalizeRetention({
        enabled: true,
        days: typeof row.retention_days === 'number' ? row.retention_days : undefined
      })
    }))
    // Defensive: never purge on an invalid window.
    .filter((entry) => entry.settings.days >= 1 && entry.settings.days <= 3650);
}