import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { recordClick } from '@/lib/analytics/record-click';
import { recordAssignment } from '@/lib/analytics/record-assignment';
import { decideRedirect } from '@/lib/links/resolve';
import { logEvent, logError, EVENTS, correlationIdFrom, setCorrelationId } from '@/lib/log';
import { checkRateLimit, policyFor, callerKeyFromHeaders } from '@/lib/ratelimit/limiter';
import { resolveRedirectTarget, experimentSalt } from '@/lib/links/resolve-target';
import { domainConfigFromEnv, resolveHostScope } from '@/lib/links/domains';
import { loadRedirectConfig } from '@/lib/links/redirect-config';

function htmlResponse(status: number, title: string, message: string): NextResponse {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>${title}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#0b1220;display:grid;place-items:center;min-height:100vh}
.card{max-width:32rem;padding:2rem;border-radius:1rem;background:#fff;border:1px solid #e3e6ec}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{color:#5b6472;margin:0}
</style>
</head>
<body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive'
    }
  });
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  // Per-request correlation id. Not a visitor identifier and never persisted.
  const correlationId = correlationIdFrom(request.headers);
  setCorrelationId(correlationId);

  const { slug } = await context.params;

  /**
   * Abuse control is applied to the *failure* path only.
   *
   * Successful redirects are deliberately NOT rate limited: charging a bucket on
   * every visit would add a database round trip to the latency-sensitive path and
   * could penalise a whole office sharing one address. Enumeration and scraping
   * concentrate in 404/410 responses, so that is where the budget is spent.
   */
  const chargeFailurePath = async () => {
    const limit = await checkRateLimit(policyFor('redirect', callerKeyFromHeaders(request.headers)));
    if (limit.allowed) return false;
    logEvent(EVENTS.redirectRateLimited, 'warn', { correlation_id: correlationId });
    return true;
  };

  if (!slug || slug.includes('/') || slug.includes('\\')) {
    return htmlResponse(404, 'Link not found', 'This short link does not exist.');
  }

  try {
    const supabase = getServiceSupabase();

    // Alias domains are opt-in via ALIAS_DOMAINS; with the feature off this
    // always resolves to the canonical domain, exactly as before.
    const hostScope = resolveHostScope(
      request.headers.get('host'),
      domainConfigFromEnv(process.env, process.env.NEXT_PUBLIC_APP_URL)
    );

    let lookup = supabase
      .from('links')
      .select('id, destination_url, is_active, expires_at, created_by')
      .eq('slug', slug);

    // Only narrow by domain when an alias is actually in play.
    if (hostScope.isAlias) {
      lookup = lookup.eq('domain', hostScope.domain);
    } else {
      lookup = lookup.eq('domain', '');
    }

    const { data: link } = await lookup.single();

    // Lifecycle first: disabled/expired links never reach the redirect engine.
    const decision = decideRedirect(link);
    if (decision.kind !== 'redirect') {
      if (await chargeFailurePath()) {
        return htmlResponse(429, 'Slow down', 'Too many lookups. Please try again shortly.');
      }
      if (decision.kind === 'not_found') {
        return htmlResponse(404, 'Link not found', 'This short link does not exist or may have been removed.');
      }
      const message =
        decision.reason === 'expired'
          ? 'This short link has expired.'
          : decision.reason === 'disabled'
            ? 'This short link is currently disabled.'
            : 'This short link is unavailable.';
      return htmlResponse(410, 'Link unavailable', message);
    }

    // One embedded query for all rule data, with a per-table fallback inside
    // the loader so a partial schema can never break the redirect.
    const { schedules, variants, rules } = await loadRedirectConfig(link!.id);

    const requestUrl = new URL(request.url);
    const query: Record<string, string> = {};
    for (const [key, value] of requestUrl.searchParams.entries()) query[key] = value;

    const resolved = resolveRedirectTarget({
      linkId: link!.id,
      linkDestination: decision.location,
      domain: hostScope.domain,
      schedules,
      variants,
      rules,
      query,
      now: new Date(),
      salt: experimentSalt()
    });

    const location = resolved.destination;

    await recordClick({
      linkId: link!.id,
      ownerId: link!.created_by ?? undefined,
      referrer: request.headers.get('referer'),
      userAgent: request.headers.get('user-agent'),
      variantLabel: resolved.variantLabel
    });

    if (resolved.experimentId) {
      await recordAssignment(resolved.experimentId, resolved.variantLabel);
    }

    const response = NextResponse.redirect(location, 302);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.headers.set('X-Request-Id', correlationId);
    return response;
  } catch (error) {
    // Log the failure type internally; return a generic page to the visitor.
    logError(EVENTS.redirectError, error, { correlation_id: correlationId, slug_length: slug.length });
    return htmlResponse(503, 'Temporarily unavailable', 'This short link could not be resolved right now. Please try again later.');
  }
}