'use server';

import { revalidatePath } from 'next/cache';
import { assertOwner } from '@/lib/auth/owner';
import { saveOwnerSettings } from '@/lib/settings/repo';
import { invalidateSettingsCache } from '@/lib/settings/cache';
import { normalizeRetention, isValidRetentionDays } from '@/lib/retention/retention';
import { normalizeAggregation } from '@/lib/settings/aggregation';

export interface SettingsActionResult {
  ok: boolean;
  message: string;
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Persist retention and aggregation preferences.
 *
 * Checkboxes are absent from FormData when unchecked, so retention and the two
 * aggregation dimensions are each explicitly opted into.
 */
export async function saveSettingsAction(
  _prev: SettingsActionResult,
  formData: FormData
): Promise<SettingsActionResult> {
  const owner = await assertOwner();

  const enabled = formData.get('retention_enabled') === 'on';
  const rawDays = getString(formData, 'retention_days').trim();
  const parsedDays = rawDays === '' ? Number.NaN : Number(rawDays);

  if (enabled && !isValidRetentionDays(parsedDays)) {
    return { ok: false, message: 'Retention must be between 1 and 3650 days.' };
  }

  const retention = normalizeRetention({ enabled, days: parsedDays });
  const aggregation = normalizeAggregation({
    track_referrer: formData.get('track_referrer') === 'on',
    track_device: formData.get('track_device') === 'on'
  });

  const saved = await saveOwnerSettings(owner.id, { retention, aggregation });
  if (!saved) return { ok: false, message: 'Unable to save settings.' };

  // Apply immediately rather than waiting out the cache TTL.
  invalidateSettingsCache(owner.id);
  revalidatePath('/settings');

  return {
    ok: true,
    message: retention.enabled
      ? `Saved. Click data older than ${retention.days} days will be deleted daily.`
      : 'Saved. Retention is off, so all click history is kept.'
  };
}