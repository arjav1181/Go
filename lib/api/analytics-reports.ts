import type { NextResponse } from 'next/server';
import { authorizeApiRequest, apiError, apiJson } from './auth';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { findOwnedLink } from '@/lib/links/service';
import { resolveWindow } from './report-window';

export const dynamic = 'force-dynamic';

/**
 * Per-link analytics report handlers (spec §13).
 *
 * Lives in lib/ rather than beside the route files because Next.js reserves the
 * route segment folders for `page`/`route` files, and a helper dropped in there
 * is one refactor away from being mistaken for an endpoint.
 *
 * All three endpoints take the same shape — a link id and a date window — so
 * the parsing, window defaulting and ownership check are shared here rather
 * than repeated three times and drifting.
 */

/**
 * Resolve the link and prove the caller owns it.
 *
 * `findOwnedLink` takes the owner id first and only accepts a UUID, so slug
 * lookups are resolved here first when one is supplied.
 */
async function resolveLink(
  ownerId: string,
  idParam: string
): Promise<{ id: string } | { error: NextResponse }> {
  let link = await findOwnedLink(ownerId, idParam);

  if (!link) {
    // Allow a slug as well as a UUID, since a short link is what people copy.
    const supabase = getServiceSupabase();
    const { data } = await supabase
      .from('links')
      .select('id')
      .eq('slug', idParam)
      .eq('created_by', ownerId)
      .maybeSingle();
    link = (data as { id: string } | null) ?? null;
  }

  if (!link) {
    return { error: apiError('not_found', 'Link not found.') };
  }
  return { id: link.id };
}

/**
 * GET /api/v1/links/{id}/clicks/summary
 *
 * Total clicks over the window, rolled up per variant and campaign.
 */
export async function summary(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'analytics:read');
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const link = await resolveLink(auth.ownerId, id);
  if ('error' in link) return link.error;

  const { from, to } = resolveWindow(new URL(request.url).searchParams);

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('click_summary', {
    p_link_id: link.id,
    p_from: from,
    p_to: to
  });

  if (error) return apiError('server_error', 'Unable to read click summary.');

  const rows = (data ?? []) as Array<{
    total_clicks: number;
    days_with_clicks: number;
    variant_label: string;
    campaign: string;
  }>;

  const total = rows.reduce((n, r) => n + Number(r.total_clicks ?? 0), 0);

  return apiJson({
    unit: 'summary',
    // The documented shape is a single rolled-up field.
    total_clicks: total,
    unit_referer: null,
    unit_reference: null,
    from,
    to,
    breakdown: rows.map((r) => ({
      variant_label: r.variant_label || null,
      campaign: r.campaign || null,
      total_clicks: Number(r.total_clicks ?? 0),
      days_with_clicks: Number(r.days_with_clicks ?? 0)
    }))
  });
}

/**
 * GET /api/v1/links/{id}/countries
 *
 * Country distribution. Values come from the CDN edge, so they are
 * network-derived approximations rather than precise locations — the same
 * caveat the spec attaches to its own location reporting.
 */
export async function countries(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'analytics:read');
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const link = await resolveLink(auth.ownerId, id);
  if ('error' in link) return link.error;

  const { from, to } = resolveWindow(new URL(request.url).searchParams);

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('country_breakdown', {
    p_link_id: link.id,
    p_from: from,
    p_to: to
  });

  if (error) return apiError('server_error', 'Unable to read country data.');

  const rows = (data ?? []) as Array<{ country_code: string; clicks: number }>;
  return apiJson({
    from,
    to,
    // Empty when the edge never resolved a country. Reported explicitly rather
    // than as an empty array, so a caller can tell "no data" from "no traffic".
    data: rows.map((r) => ({ country: r.country_code, clicks: Number(r.clicks ?? 0) })),
    note: 'Country is derived from edge network signals and is an approximation, not a precise location.'
  });
}

/**
 * GET /api/v1/links/{id}/referring_domains
 *
 * Distinct sites that sent traffic, collapsed to one row per host. Distinct
 * from /referrers, which keeps each referring URL.
 */
export async function referringDomains(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'analytics:read');
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const link = await resolveLink(auth.ownerId, id);
  if ('error' in link) return link.error;

  const { from, to } = resolveWindow(new URL(request.url).searchParams);

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('referring_domain_breakdown', {
    p_link_id: link.id,
    p_from: from,
    p_to: to
  });

  if (error) return apiError('server_error', 'Unable to read referring domains.');

  const rows = (data ?? []) as Array<{ domain: string; clicks: number }>;
  return apiJson({
    from,
    to,
    data: rows.map((r) => ({ domain: r.domain, clicks: Number(r.clicks ?? 0) }))
  });
}