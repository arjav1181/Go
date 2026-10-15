import { getServiceSupabase } from '@/lib/db/supabase-server';

/**
 * Adopt links that were created before `created_by` was recorded.
 *
 * Links created by the P0 release predate owner tracking and therefore have
 * `created_by IS NULL`. Without this backfill they would be invisible once
 * queries scope by owner. This service is owner-operated, so claiming
 * unowned rows on first access is the correct and intended behaviour.
 *
 * Idempotent: once claimed, the predicate no longer matches.
 */
export async function claimUnownedLinks(ownerId: string): Promise<void> {
  try {
    const supabase = getServiceSupabase();
    await supabase
      .from('links')
      .update({ created_by: ownerId })
      .is('created_by', null);
  } catch {
    // Non-fatal: unclaimed links simply stay out of the scoped view.
  }
}