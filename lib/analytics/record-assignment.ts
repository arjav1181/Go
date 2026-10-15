import { getServiceSupabase } from '@/lib/db/supabase-server';

/**
 * Record that a variant was served for a request.
 *
 * Kept separate from the click counter so a visitor still counts as assigned
 * even if the click write fails. Aggregate only: no visitor identity is stored.
 * Failures are swallowed so analytics can never break a redirect.
 */
export async function recordAssignment(
  experimentId: string,
  variantLabel: string
): Promise<void> {
  try {
    if (!experimentId || !variantLabel) return;
    const day = new Date().toISOString().slice(0, 10);
    const supabase = getServiceSupabase();
    await supabase.rpc('increment_experiment_assignment', {
      p_experiment_id: experimentId,
      p_variant_label: variantLabel.slice(0, 32),
      p_day: day
    });
  } catch {
    // Never surface analytics failures to a visitor.
  }
}
