import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { safeHashEquals } from '@/lib/api/keys';
import { listRetentionEnabledOwners } from '@/lib/settings/repo';
import { shouldPurge, computeCutoffDay, type RetentionSettings } from '@/lib/retention/retention';
import { logEvent, EVENTS } from '@/lib/log';
import { recordOperationalEvent, PERSISTED_EVENTS } from '@/lib/observability';

export const dynamic = 'force-dynamic';

/**
 * Scheduled purge of aggregate click history.
 *
 * Intended for Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`
 * automatically. This is a system endpoint, not an owner endpoint, so it is
 * gated on the shared secret rather than a session.
 *
 * Fails CLOSED: if CRON_SECRET is unset the endpoint refuses to run, so a
 * misconfigured deployment can never start deleting data unauthenticated.
 */
export async function GET(request: Request) {
  const authResult = verifyCronSecret(request);
  if (!authResult.ok) return authResult.response;

  try {
    const owners = await listRetentionEnabledOwners();
    const now = new Date();

    const targets = owners
      .map((entry) => ({ ownerId: entry.ownerId, settings: entry.settings }))
      .filter((entry) => shouldPurge(entry.settings));

    if (targets.length === 0) {
      logEvent(EVENTS.cronRun, 'info', { job: 'purge', purged_owners: 0 });
      await recordOperationalEvent(PERSISTED_EVENTS.cronRun, 'info', {
        job: 'purge',
        purged_owners: 0,
        detail: 'retention disabled for all owners'
      });
      return NextResponse.json({
        purged_owners: 0,
        purged: false,
        reason: 'retention disabled for all owners'
      });
    }

    const supabase = getServiceSupabase();
    let totalDeleted = 0;
    const perOwner: Array<{ owner: string; cutoff: string; deleted: number }> = [];

    for (const target of targets) {
      const cutoff = computeCutoffDay(target.settings as RetentionSettings, now);

      // Only prune rows belonging to this owner's links.
      const { data: links } = await supabase
        .from('links')
        .select('id')
        .eq('created_by', target.ownerId);

      const linkIds = (links ?? []).map((link) => (link as { id: string }).id);
      if (linkIds.length === 0) continue;

      const { error, count } = await supabase
        .from('daily_click_stats')
        .delete({ count: 'exact' })
        .in('link_id', linkIds)
        .lt('day', cutoff);

      if (error) continue;

      const deleted = count ?? 0;
      totalDeleted += deleted;
      perOwner.push({ owner: target.ownerId, cutoff, deleted });
    }

    // Recorded durably: a purge that silently stops running is indistinguishable
    // from a purge that correctly has nothing to do, and only one of those is
    // a problem. This is the signal that tells them apart.
    logEvent(EVENTS.purgeCompleted, 'info', {
      purged_owners: perOwner.length,
      deleted_rows: totalDeleted
    });
    await recordOperationalEvent(PERSISTED_EVENTS.purgeCompleted, 'info', {
      purged_owners: perOwner.length,
      deleted_rows: totalDeleted
    });

    return NextResponse.json({
      purged: totalDeleted > 0,
      purged_owners: perOwner.length,
      deleted_rows: totalDeleted,
      per_owner: perOwner
    });
  } catch (err) {
    logEvent(EVENTS.cronFailed, 'error', {
      job: 'purge',
      error_type: err instanceof Error ? err.name : typeof err
    });
    await recordOperationalEvent(PERSISTED_EVENTS.cronFailed, 'error', {
      job: 'purge',
      error_type: err instanceof Error ? err.name : typeof err
    });

    // Never leak internal detail from a scheduled job.
    return NextResponse.json({ error: 'Purge failed.' }, { status: 500 });
  }
}

/** Constant-time check of the cron secret. */
function verifyCronSecret(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Purge is not configured.' },
        { status: 503 }
      )
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1];
  if (!token || !safeHashEquals(token, secret)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    };
  }

  return { ok: true };
}