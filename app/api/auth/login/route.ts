import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { checkRateLimit, policyFor, callerKeyFromHeaders, hashBucketKey } from '@/lib/ratelimit/limiter';
import { logEvent, EVENTS, correlationIdFrom } from '@/lib/log';
import { recordOperationalEvent, PERSISTED_EVENTS } from '@/lib/observability';

export const dynamic = 'force-dynamic';

const MAX_BODY = 4_096;

/**
 * Server-side sign-in.
 *
 * Sign-in moved behind an API route specifically so that attempts can be
 * rate limited on the server; a limit enforced in the browser is not a control.
 *
 * Two independent budgets are charged per attempt:
 *  - per caller, to stop broad guessing;
 *  - per account, to stop one account being sprayed from many addresses.
 *
 * Responses never distinguish "unknown account" from "wrong password".
 */
export async function POST(request: Request) {
  const correlationId = correlationIdFrom(request.headers);

  let body: { email?: unknown; password?: unknown };
  try {
    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > MAX_BODY) {
      return NextResponse.json({ error: 'Too large.' }, { status: 413 });
    }
    const text = await request.text();
    if (text.length > MAX_BODY) {
      return NextResponse.json({ error: 'Too large.' }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration the endpoint must not pretend to authenticate.
  if (!url || !anonKey) {
    logEvent(EVENTS.loginFailed, 'warn', { correlation_id: correlationId, reason: 'not_configured' });
    await recordOperationalEvent(PERSISTED_EVENTS.loginFailed, 'warn', { reason: 'not_configured' });
    return NextResponse.json({ error: 'Sign-in is unavailable.' }, { status: 503 });
  }

  // Per-account budget: keyed on a hash so the address is never stored.
  const accountLimit = await checkRateLimit(
    policyFor('login', hashBucketKey(email, 'account'), { failOpen: true })
  );
  const callerLimit = await checkRateLimit(policyFor('login', callerKeyFromHeaders(request.headers)));

  if (!accountLimit.allowed || !callerLimit.allowed) {
    logEvent(EVENTS.authRateLimited, 'warn', {
      correlation_id: correlationId,
      account_blocked: !accountLimit.allowed,
      limiter_degraded: accountLimit.degraded || callerLimit.degraded
    });
    await recordOperationalEvent(PERSISTED_EVENTS.authRateLimited, 'warn', {
      account_blocked: !accountLimit.allowed,
      limiter_degraded: accountLimit.degraded || callerLimit.degraded
    });
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(accountLimit.retryAfterSeconds, callerLimit.retryAfterSeconds))
        }
      }
    );
  }

  const response = NextResponse.json({ ok: true });
  const cookieHeaders: string[] = [];

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        const header = request.headers.get('cookie') ?? '';
        return header
          .split(';')
          .map((pair) => {
            const index = pair.indexOf('=');
            if (index === -1) return null;
            return {
              name: pair.slice(0, index).trim(),
              value: decodeURIComponent(pair.slice(index + 1).trim())
            };
          })
          .filter((item): item is { name: string; value: string } => item !== null);
      },
      setAll(cookiesToSet: { name: string; value: string; options?: { path?: string; maxAge?: number } }[]) {
        for (const cookie of cookiesToSet) {
          cookieHeaders.push(
            `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=${cookie.options?.path ?? '/'}` +
              (cookie.options?.maxAge ? `; Max-Age=${cookie.options.maxAge}` : '') +
              '; HttpOnly; Secure; SameSite=Lax'
          );
        }
      }
    }
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    // Log the reason server-side; return the same message either way.
    logEvent(EVENTS.loginFailed, 'warn', {
      correlation_id: correlationId,
      reason: error?.name ?? 'unknown'
    });
    // Counted, not just logged: a spike in failures is something to alert on.
    // The address is never included.
    await recordOperationalEvent(PERSISTED_EVENTS.loginFailed, 'warn', {
      reason: error?.name ?? 'unknown'
    });
    return NextResponse.json(
      { error: 'Sign-in failed. Check your credentials and try again.' },
      { status: 401 }
    );
  }

  for (const cookie of cookieHeaders) {
    response.headers.append('Set-Cookie', cookie);
  }

  return response;
}
