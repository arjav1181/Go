import 'server-only';

import { getServiceSupabase } from '@/lib/db/supabase-server';
import { logEvent, redact, type Severity, type PersistedEvent } from '@/lib/log';

/**
 * Durable operational event store.
 *
 * `lib/log.ts` writes to stdout, which is the right place for high-volume
 * request logging but is not queryable: a host's log retention is not ours to
 * control, and there is no way to ask "how many failed logins last night".
 *
 * This module additionally records a small set of **low-volume, security
 * relevant** events in Postgres so they can be counted and alerted on.
 *
 * Deliberately not used on the redirect hot path. A database write per redirect
 * would make the cheapest possible operation the most expensive one. The events
 * recorded here are all administrative or abuse-related and are rare by
 * definition.
 */

const SEVERITY_ALLOWED = new Set(['info', 'warn', 'error']);


/**
 * Record an operational event.
 *
 * Never throws and never rejects. This runs inside request handling, so an
 * observability failure must not become a user-facing error. The outcome is
 * reported through the return value and the stdout log rather than propagated.
 *
 * Returns true when the event was durably stored.
 */
export { PERSISTED_EVENTS } from '@/lib/log';

export async function recordOperationalEvent(
  event: PersistedEvent | string,
  severity: Severity = 'info',
  context: Record<string, unknown> = {}
): Promise<boolean> {
  const safeSeverity = SEVERITY_ALLOWED.has(severity) ? severity : 'info';

  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase.rpc('record_operational_event', {
      p_event: event,
      p_severity: safeSeverity,
      // Redacted exactly like the stdout log, so an operational event can never
      // become a side channel for data the log path would have dropped.
      p_context: redact(context)
    });

    if (error) throw new Error(error.message);
    return data === true;
  } catch (err) {
    logEvent('observability.store_failed', 'warn', {
      target_event: event,
      error_type: err instanceof Error ? err.name : typeof err
    });
    return false;
  }
}
