import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { recordClick } from '@/lib/analytics/record-click';
import { recordAssignment } from '@/lib/analytics/record-assignment';
import { decideRedirect } from '@/lib/links/resolve';
import { logEvent, logError, EVENTS, correlationIdFrom, setCorrelationId } from '@/lib/log';
import { checkRateLimit, policyFor, callerKeyFromHeaders } from '@/lib/ratelimit/limiter';
import { resolveRedirectTarget, experimentSalt } from '@/lib/links/resolve-target';
import { domainConfigFromEnv, resolveHostScope } from '@/lib/links/domains';
import { loadLinkWithConfig } from '@/lib/links/redirect-config';
import { after } from 'next/server';
import { verifyLinkPassword } from '@/lib/links/passwords';
import { campaignFromUrl, withCampaignParam } from '@/lib/links/campaigns';
import { recordOperationalEvent, PERSISTED_EVENTS } from '@/lib/observability';

function htmlResponse(status: number, title: string, message: string): NextResponse {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>${title}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#000;display:grid;place-items:center;min-height:100vh;padding:1.5rem}
@media (prefers-color-scheme:dark){body{background:#000;color:#ededed}}
.card{max-width:30rem;width:100%;padding:2rem;border-radius:12px;background:inherit;border:1px solid rgba(128,128,128,.28)}
h1{font-size:1.125rem;line-height:1.3;letter-spacing:-.02em;font-weight:600;margin:0 0 .5rem}
p{color:#666;margin:0;line-height:1.6;font-size:.875rem}
@media (prefers-color-scheme:dark){p{color:#a1a1a1}}
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

/**
 * Password prompt for a protected link.
 *
 * Deliberately never renders the destination, a preview, or any hint about the
 * link. A wrong guess must leak nothing beyond "wrong".
 */
/**
 * Owner-branded 404 content.
 *
 * Returns the neutral default when no branding is configured or the lookup
 * fails, so a settings problem can never take the 404 path down.
 */
async function loadNotFoundBranding(): Promise<{ title: string; body: string; link: string }> {
  const neutral = { title: '', body: '', link: '' };
  try {
    const { data } = await getServiceSupabase()
      .from('owner_settings')
      .select('custom_404_enabled, custom_404_title, custom_404_body, custom_404_link')
      .eq('custom_404_enabled', true)
      .limit(1)
      .maybeSingle();

    if (!data) return neutral;
    return {
      title: (data.custom_404_title as string) ?? '',
      body: (data.custom_404_body as string) ?? '',
      link: (data.custom_404_link as string) ?? ''
    };
  } catch {
    return neutral;
  }
}

/**
 * Owner-configurable 404.
 *
 * Only the title, a short body and one link are honoured, and all three are
 * escaped. A branded page must never become a way to reflect markup or a
 * javascript: URL back at whoever mistyped a slug.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function brandedNotFound(branding: {
  title: string;
  body: string;
  link: string;
}): NextResponse {
  const hasTitle = branding.title.trim() !== '';
  if (!hasTitle) return htmlResponse(404, 'Link not found', 'This short link does not exist or may have been removed.');

  const title = escapeHtml(branding.title.slice(0, 120));
  const body = escapeHtml(branding.body.slice(0, 500));

  let action = '';
  const href = branding.link.trim();
  if (href !== '') {
    try {
      const parsed = new URL(href);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        action = `<p style="margin-top:1.25rem"><a href="${escapeHtml(parsed.toString())}" rel="noopener noreferrer" style="color:#0070f3">Continue</a></p>`;
      }
    } catch {
      // An unusable link is simply omitted rather than rendered.
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>${title}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#000;display:grid;place-items:center;min-height:100vh;padding:1.5rem}
@media (prefers-color-scheme:dark){body{background:#000;color:#ededed}}
.card{max-width:30rem;width:100%;padding:2rem;border-radius:12px;border:1px solid rgba(128,128,128,.28);text-align:center}
h1{font-size:1.25rem;line-height:1.3;letter-spacing:-.02em;font-weight:600;margin:0 0 .5rem}
p{color:#666;margin:0;font-size:.9375rem;line-height:1.6}
@media (prefers-color-scheme:dark){p{color:#a1a1a1}}
</style>
</head>
<body><main class="card"><h1>${title}</h1>${body ? `<p>${body}</p>` : ''}${action}</main></body></html>`;

  return new NextResponse(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive'
    }
  });
}

function passwordPrompt(slug: string, error?: string): NextResponse {
  const note = error
    ? `<p role="alert" style="color:#d1373a;margin:0 0 1rem">${error}</p>`
    : '';
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>Password required</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#000;display:grid;place-items:center;min-height:100vh;padding:1.5rem}
@media (prefers-color-scheme:dark){body{background:#000;color:#ededed}}
.card{max-width:22rem;width:100%;padding:1.5rem;border-radius:12px;border:1px solid rgba(128,128,128,.28)}
h1{font-size:1.0625rem;letter-spacing:-.02em;font-weight:600;margin:0 0 .375rem}
p{color:#666;margin:0 0 1rem;font-size:.8125rem;line-height:1.6}
label{display:block;font-size:.75rem;font-weight:500;margin-bottom:.375rem}
input{width:100%;height:2.25rem;padding:0 .75rem;border-radius:6px;border:1px solid transparent;background:rgba(128,128,128,.12);color:inherit;font-size:.875rem;box-sizing:border-box}
input:focus{outline:2px solid #0070f3;outline-offset:2px}
button{width:100%;height:2.25rem;margin-top:.75rem;border-radius:6px;border:0;background:#000;color:#fff;font-size:.875rem;font-weight:500;cursor:pointer}
@media (prefers-color-scheme:dark){button{background:#ededed;color:#000}p{color:#a1a1a1}}
</style>
</head>
<body><main class="card">
<h1>This link is password protected</h1>
<p>Enter the password to continue.</p>
${note}
<form method="post" action="/${encodeURIComponent(slug)}">
<label for="pw">Password</label>
<input id="pw" name="pw" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required autofocus />
<button type="submit">Continue</button>
</form>
</main></body></html>`;

  return new NextResponse(body, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'WWW-Authenticate': 'Form'
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
    // Alias domains are opt-in via ALIAS_DOMAINS; with the feature off this
    // always resolves to the canonical domain, exactly as before.
    const hostScope = resolveHostScope(
      request.headers.get('host'),
      domainConfigFromEnv(process.env, process.env.NEXT_PUBLIC_APP_URL)
    );

    /**
     * One round trip for the link and all of its routing config.
     *
     * Previously this was two queries that both started from `links`: resolve
     * the slug, then fetch schedules/variants/rules by id. Folding them
     * together removes a full database round trip from every redirect.
     */
    const link = await loadLinkWithConfig({
      slug,
      domain: hostScope.isAlias ? hostScope.domain : ''
    });

    // Lifecycle first: disabled/expired links never reach the redirect engine.
    const decision = decideRedirect(link);
    if (decision.kind !== 'redirect') {
      if (await chargeFailurePath()) {
        return htmlResponse(429, 'Slow down', 'Too many lookups. Please try again shortly.');
      }
      if (decision.kind === 'not_found') {
        // Branding is only consulted on the 404 path, never on a redirect, so
        // the cost of this extra read is only paid by people who mistyped.
        const branding = await loadNotFoundBranding();
        return brandedNotFound(branding);
      }
      const message =
        decision.reason === 'expired'
          ? 'This short link has expired.'
          : decision.reason === 'disabled'
            ? 'This short link is currently disabled.'
            : 'This short link is unavailable.';
      return htmlResponse(410, 'Link unavailable', message);
    }

    /**
     * Password gate.
     *
     * The destination is never touched before the password is verified: rules,
     * schedules, variants and analytics all sit *after* this check, so a wrong
     * guess reveals neither the target nor the fact that a schedule exists.
     */
    if (link!.password_hash) {
      const supplied = new URL(request.url).searchParams.get('pw');
      if (!supplied || !verifyLinkPassword(link!.password_hash, supplied)) {
        after(() =>
          recordOperationalEvent(PERSISTED_EVENTS.linkPasswordPrompted, 'info', {})
        );
        return passwordPrompt(slug, supplied ? 'That password is not correct.' : undefined);
      }
    }

    const { schedules, variants, rules } = link!;

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

    /**
     * Campaign marker.
     *
     * The owner's own campaign label is attached to the outbound destination so
     * the destination's analytics can attribute the click. A per-visit marker
     * from the query string is deliberately NOT propagated: it would let a
     * visitor write arbitrary values into a third party's analytics.
     */
    const campaign = campaignFromUrl(request.url) ?? link!.campaign ?? null;
    const location = link!.campaign
      ? withCampaignParam(resolved.destination, link!.campaign)
      : resolved.destination;

    /**
     * Analytics run *after* the response is sent.
     *
     * These were previously awaited, which put two database round trips in
     * front of every visitor. `after()` keeps the exact same guarantees — the
     * events are still written on the platform's behalf, and failures are
     * still swallowed — but they no longer delay the 302.
     */
    after(async () => {
      await recordClick({
        linkId: link!.id,
        ownerId: link!.created_by ?? undefined,
        referrer: request.headers.get('referer'),
        userAgent: request.headers.get('user-agent'),
        variantLabel: resolved.variantLabel,
        campaign
      });

      if (resolved.experimentId) {
        await recordAssignment(resolved.experimentId, resolved.variantLabel);
      }
    });

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