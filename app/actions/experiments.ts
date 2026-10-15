'use server';

import { revalidatePath } from 'next/cache';
import { assertOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { normalizeDestinationUrl, shortHostFromAppUrl } from '@/lib/links/validation';
import { validateLabel } from '@/lib/tags/validation';
import { FOLDER_MAX } from '@/lib/tags/validation';
import { logEvent, EVENTS } from '@/lib/log';
import { buildConfigSnapshot } from '@/lib/experiments/replay';
import { experimentSalt } from '@/lib/links/resolve-target';
import { checkRateLimit, policyFor } from '@/lib/ratelimit/limiter';

export interface ExperimentActionResult {
  ok: boolean;
  message: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shortHost = shortHostFromAppUrl(process.env.NEXT_PUBLIC_APP_URL);

type VariantInput = { label: string; destination_url: string; weight: number };

export type ExperimentStatus = 'active' | 'paused' | 'stopped';

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function parseInstantOrNull(value: string): Date | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function snapshotExperimentConfig(
  experimentId: string,
  linkId: string,
  variants: VariantInput[],
  reason: string
): Promise<void> {
  try {
    const supabase = getServiceSupabase();
    const { count } = await supabase
      .from('experiment_config_versions')
      .select('version', { count: 'exact', head: true })
      .eq('experiment_id', experimentId);

    const nextVersion = (count ?? 0) + 1;
    const { data: rows } = await supabase
      .from('link_variants')
      .select('id, label, destination_url, weight, is_active')
      .eq('experiment_id', experimentId);

    const config = buildConfigSnapshot({
      linkId,
      domain: '',
      salt: experimentSalt(),
      variants: rows ?? variants.map((v, i) => ({ id: `v${i}`, ...v, is_active: true })),
      version: nextVersion
    });

    await supabase.from('experiment_config_versions').insert({
      experiment_id: experimentId,
      version: nextVersion,
      config,
      reason
    });
  } catch {
    // A missing snapshot degrades reproducibility but must not block creation.
  }
}

function requireUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

/**
 * Create an experiment together with its first variants.
 *
 * The link's previous destination is preserved as the fallback: if the
 * experiment is stopped or paused, traffic returns to it unchanged.
 */
export async function createExperimentAction(
  linkId: string,
  _prev: ExperimentActionResult,
  formData: FormData
): Promise<ExperimentActionResult> {
  const owner = await assertOwner();
  requireUuid(linkId, 'link id');

  // Reuse the link-creation budget: an experiment is a heavier mutation.
  const limit = await checkRateLimit(policyFor('linkCreate', owner.id));
  if (!limit.allowed) {
    logEvent(EVENTS.linkCreateRejected, 'warn', { reason: 'rate_limited', resource: 'experiment' });
    return { ok: false, message: 'Too many experiments created recently. Please wait.' };
  }

  const name = validateLabel(getString(formData, 'name'), FOLDER_MAX, 'folder');
  if (!name.ok) return { ok: false, message: name.error.replace('Folder name', 'Experiment name') };

  const labels = formData.getAll('variant_label');
  const destinations = formData.getAll('variant_destination');
  const weights = formData.getAll('variant_weight');

  if (labels.length === 0) {
    return { ok: false, message: 'Add at least one variant.' };
  }

  const variants: VariantInput[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    const rawLabel = labels[i];
    const rawDestination = destinations[i];
    const rawWeight = weights[i];

    const labelText = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (labelText === '') continue;

    const labelResult = validateLabel(labelText, 32, 'tag');
    if (!labelResult.ok) {
      return { ok: false, message: labelResult.error.replace('Tag name', 'Variant label') };
    }
    const label = labelResult.name.replace(/\s+/g, '-').slice(0, 32);

    const destination = normalizeDestinationUrl(
      typeof rawDestination === 'string' ? rawDestination : '',
      shortHost
    );
    if (!destination.ok) return { ok: false, message: destination.error };

    const weightText = typeof rawWeight === 'string' ? rawWeight.trim() : '';
    const weight = weightText === '' ? 0 : Number(weightText);
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
      return { ok: false, message: 'Each weight must be a whole number between 0 and 100.' };
    }

    variants.push({ label, destination_url: destination.url, weight });
  }

  if (variants.length === 0) return { ok: false, message: 'Add at least one valid variant.' };

  const total = variants.reduce((sum, variant) => sum + Math.max(0, variant.weight), 0);
  if (total <= 0) {
    return { ok: false, message: 'At least one variant needs a weight above zero.' };
  }

  const hypothesis = getString(formData, 'hypothesis').trim().slice(0, 500) || null;
  const windowStart = parseInstantOrNull(getString(formData, 'starts_at'));
  const windowEnd = parseInstantOrNull(getString(formData, 'ends_at'));

  if (windowStart && windowEnd && windowEnd.getTime() <= windowStart.getTime()) {
    return { ok: false, message: 'The experiment window must end after it starts.' };
  }

  const supabase = getServiceSupabase();

  // Only one running experiment per link keeps traffic unambiguous.
  const { data: running } = await supabase
    .from('link_experiments')
    .select('id')
    .eq('link_id', linkId)
    .eq('status', 'active')
    .maybeSingle();

  if (running) {
    return {
      ok: false,
      message: 'This link already has a running experiment. Stop it before starting another.'
    };
  }

  const { data: experiment, error } = await supabase
    .from('link_experiments')
    .insert({
      link_id: linkId,
      name: name.name,
      status: 'active',
      created_by: owner.id,
      hypothesis,
      outcome_metric: 'clicks',
      starts_at: windowStart,
      ends_at: windowEnd
    })
    .select('id')
    .single();

  if (error || !experiment) {
    return { ok: false, message: 'Unable to create experiment.' };
  }

  const rows = variants.map((variant) => ({
    link_id: linkId,
    experiment_id: experiment.id,
    label: variant.label,
    destination_url: variant.destination_url,
    weight: variant.weight,
    is_active: true
  }));

  const { error: variantError } = await supabase.from('link_variants').insert(rows);
  if (variantError) {
    // Roll back so a half-created experiment cannot serve traffic.
    await supabase.from('link_experiments').delete().eq('id', experiment.id);
    return { ok: false, message: 'Unable to create variants.' };
  }

  // Archive the routing configuration immediately so results stay reproducible
  // even after the experiment is edited or stopped later.
  await snapshotExperimentConfig(experiment.id, linkId, variants, 'created');

  logEvent('experiments.created', 'info', { experiment_id: experiment.id });
  revalidatePath(`/links/${linkId}`);
  return { ok: true, message: `Experiment "${name.name}" started.` };
}

/**
 * Pause, resume or stop an experiment.
 *
 * - paused : falls back to the link destination, keeping the configuration;
 * - stopped : final, and the link returns to its own destination permanently;
 * - resumed : re-enabled only from paused, never from stopped.
 */
export async function setExperimentStatusAction(
  linkId: string,
  experimentId: string,
  next: ExperimentStatus
): Promise<void> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(experimentId, 'experiment id');

  if (!['active', 'paused', 'stopped'].includes(next)) throw new Error('Invalid status.');

  const supabase = getServiceSupabase();
  const { data: current } = await supabase
    .from('link_experiments')
    .select('status')
    .eq('id', experimentId)
    .eq('link_id', linkId)
    .maybeSingle();

  if (!current) throw new Error('Experiment not found.');

  // A stopped experiment is final; resuming it would silently rewrite history.
  if (current.status === 'stopped' && next !== 'stopped') {
    throw new Error('A stopped experiment cannot be resumed.');
  }
  if (current.status !== 'active' && next === 'active') {
    const { data: running } = await supabase
      .from('link_experiments')
      .select('id')
      .eq('link_id', linkId)
      .eq('status', 'active')
      .maybeSingle();
    if (running && running.id !== experimentId) {
      throw new Error('Another experiment is already running for this link.');
    }
  }

  const { error } = await supabase
    .from('link_experiments')
    .update({
      status: next,
      stopped_at: next === 'stopped' ? new Date().toISOString() : null
    })
    .eq('id', experimentId)
    .eq('link_id', linkId);

  if (error) throw new Error('Unable to update experiment.');

  revalidatePath(`/links/${linkId}`);
}

/** Update a variant's destination or weight inside a running experiment. */
export async function updateVariantAction(
  linkId: string,
  variantId: string,
  _prev: ExperimentActionResult,
  formData: FormData
): Promise<ExperimentActionResult> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(variantId, 'variant id');

  const patch: Record<string, unknown> = {};

  if (formData.has('destination_url')) {
    const destination = normalizeDestinationUrl(getString(formData, 'destination_url'), shortHost);
    if (!destination.ok) return { ok: false, message: destination.error };
    patch.destination_url = destination.url;
  }

  if (formData.has('weight')) {
    const weight = Number(getString(formData, 'weight'));
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
      return { ok: false, message: 'Weight must be a whole number between 0 and 100.' };
    }
    patch.weight = weight;
  }

  if (formData.has('is_active')) {
    patch.is_active = getString(formData, 'is_active') === 'true';
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'Nothing to update.' };
  }

  const supabase = getServiceSupabase();

  const { data: current } = await supabase
    .from('link_variants')
    .select('experiment_id, weight, is_active')
    .eq('id', variantId)
    .eq('link_id', linkId)
    .maybeSingle();

  if (!current) return { ok: false, message: 'Variant not found.' };

  // Refuse to leave the experiment with no eligible variant. This is checked
  // BEFORE the write so nothing needs rolling back.
  if (current.experiment_id) {
    const { data: siblings } = await supabase
      .from('link_variants')
      .select('id, weight, is_active')
      .eq('experiment_id', current.experiment_id);

    const nextWeight = patch.weight !== undefined ? Number(patch.weight) : current.weight;
    const nextActive = patch.is_active !== undefined ? patch.is_active === true : current.is_active;

    const stillEligible = (siblings ?? []).some((sibling) => {
      const isTarget = sibling.id === variantId;
      const weight = isTarget ? nextWeight : sibling.weight;
      const active = isTarget ? nextActive : sibling.is_active;
      return active && Number(weight) > 0;
    });

    if (!stillEligible) {
      return {
        ok: false,
        message: 'This change would leave no active variant. Keep at least one with a weight above zero.'
      };
    }
  }

  const { error } = await supabase
    .from('link_variants')
    .update(patch)
    .eq('id', variantId)
    .eq('link_id', linkId);

  if (error) return { ok: false, message: 'Unable to update variant.' };

  revalidatePath(`/links/${linkId}`);
  return { ok: true, message: 'Variant updated.' };
}

export async function deleteExperimentAction(linkId: string, experimentId: string): Promise<void> {
  await assertOwner();
  requireUuid(linkId, 'link id');
  requireUuid(experimentId, 'experiment id');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('link_experiments')
    .delete()
    .eq('id', experimentId)
    .eq('link_id', linkId);

  if (error) throw new Error('Unable to delete experiment.');
  revalidatePath(`/links/${linkId}`);
}