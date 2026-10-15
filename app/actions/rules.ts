'use server';

import { revalidatePath } from 'next/cache';
import { assertOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { normalizeDestinationUrl, shortHostFromAppUrl } from '@/lib/links/validation';
import { validateLabel } from '@/lib/tags/validation';
import {
  findOverlappingSchedules,
  type ScheduleWindow
} from '@/lib/links/target';

export interface RuleActionResult {
  ok: boolean;
  message: string;
}

const shortHost = shortHostFromAppUrl(process.env.NEXT_PUBLIC_APP_URL);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function requireUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function parseInstant(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid date and time.`);
  }
  return date;
}

/**
 * Create a scheduled destination window.
 *
 * Windows for a link may not overlap, so which destination applies is always
 * unambiguous at request time.
 */
export async function createScheduleAction(
  linkId: string,
  _prev: RuleActionResult,
  formData: FormData
): Promise<RuleActionResult> {
  await assertOwner();
  requireUuid(linkId, 'link id');

  const destination = normalizeDestinationUrl(getString(formData, 'destination_url'), shortHost);
  if (!destination.ok) return { ok: false, message: destination.error };

  let startsAt: Date;
  let endsAt: Date | null;
  try {
    startsAt = parseInstant(getString(formData, 'starts_at'), 'Start');
    const rawEnd = getString(formData, 'ends_at').trim();
    endsAt = rawEnd === '' ? null : parseInstant(rawEnd, 'End');
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Invalid window.' };
  }

  if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, message: 'The window must end after it starts.' };
  }

  const supabase = getServiceSupabase();
  const { data: existing } = await supabase
    .from('link_schedules')
    .select('id, destination_url, starts_at, ends_at')
    .eq('link_id', linkId);

  const overlaps = findOverlappingSchedules(
    (existing ?? []) as ScheduleWindow[],
    startsAt.toISOString(),
    endsAt === null ? null : endsAt.toISOString()
  );
  if (overlaps.length > 0) {
    return {
      ok: false,
      message: 'This window overlaps an existing schedule for this link. Adjust the times.'
    };
  }

  const { error } = await supabase.from('link_schedules').insert({
    link_id: linkId,
    destination_url: destination.url,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt === null ? null : endsAt.toISOString()
  });

  if (error) return { ok: false, message: 'Unable to create schedule.' };

  revalidatePath(`/links/${linkId}`);
  return { ok: true, message: 'Scheduled destination added.' };
}

export async function deleteScheduleAction(linkId: string, scheduleId: string): Promise<void> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(scheduleId, 'schedule id');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('link_schedules')
    .delete()
    .eq('id', scheduleId)
    .eq('link_id', linkId);
  if (error) throw new Error('Unable to delete schedule.');

  revalidatePath(`/links/${linkId}`);
}

/** Add a weighted variant. Weights are relative, so [1,3] and [25,75] agree. */
export async function createVariantAction(
  linkId: string,
  _prev: RuleActionResult,
  formData: FormData
): Promise<RuleActionResult> {
  await assertOwner();
  requireUuid(linkId, 'link id');

  const labelResult = validateLabel(getString(formData, 'label'), 32, 'tag');
  if (!labelResult.ok) {
    return { ok: false, message: labelResult.error.replace('Tag name', 'Variant label') };
  }
  const label = labelResult.name.replace(/\s+/g, '-').slice(0, 32);

  const destination = normalizeDestinationUrl(getString(formData, 'destination_url'), shortHost);
  if (!destination.ok) return { ok: false, message: destination.error };

  const rawWeight = getString(formData, 'weight').trim();
  const weight = rawWeight === '' ? 0 : Number(rawWeight);
  if (!Number.isFinite(weight) || !Number.isInteger(weight) || weight < 0 || weight > 100) {
    return { ok: false, message: 'Weight must be a whole number between 0 and 100.' };
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase.from('link_variants').insert({
    link_id: linkId,
    label,
    destination_url: destination.url,
    weight,
    is_active: true
  });

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: `A variant labelled "${label}" already exists for this link.` };
    }
    return { ok: false, message: 'Unable to create variant.' };
  }

  revalidatePath(`/links/${linkId}`);
  return { ok: true, message: `Variant "${label}" added.` };
}

export async function deleteVariantAction(linkId: string, variantId: string): Promise<void> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(variantId, 'variant id');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('link_variants')
    .delete()
    .eq('id', variantId)
    .eq('link_id', linkId);
  if (error) throw new Error('Unable to delete variant.');

  revalidatePath(`/links/${linkId}`);
}

export async function toggleVariantAction(
  linkId: string,
  variantId: string,
  nextActive: boolean
): Promise<void> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(variantId, 'variant id');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('link_variants')
    .update({ is_active: nextActive })
    .eq('id', variantId)
    .eq('link_id', linkId);
  if (error) throw new Error('Unable to update variant.');

  revalidatePath(`/links/${linkId}`);
}