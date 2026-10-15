import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { logEvent, logError, EVENTS } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * Readiness check.
 *
 * Confirms the dependencies needed to *serve traffic* are reachable. It returns
 * booleans only — never hostnames, versions, credentials or driver messages,
 * because this endpoint is reachable without authentication.
 */
export async function GET() {
  const startedAt = Date.now();
  const database = { ok: false, latency_ms: 0 };
  const configuration = {
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ownerEmails: (process.env.OWNER_EMAILS ?? '').split(',').filter((v) => v.trim()).length > 0
  };

  try {
    const supabase = getServiceSupabase();
    const { error } = await supabase.from('links').select('id').limit(1);
    database.latency_ms = Date.now() - startedAt;
    database.ok = !error;
    if (error) logError(EVENTS.readyCheckFailed, error, { component: 'database' });
  } catch (error) {
    database.latency_ms = Date.now() - startedAt;
    logError(EVENTS.readyCheckFailed, error, { component: 'database' });
  }

  const ready = database.ok && configuration.supabase && configuration.serviceRole;
  if (!ready) logEvent(EVENTS.readyCheckFailed, 'warn', { ready });

  return NextResponse.json(
    {
      ready,
      database: { ok: database.ok, latency_ms: database.latency_ms },
      configuration
    },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' }
    }
  );
}
