import { NextResponse } from 'next/server';
import { authorizeApiRequest, apiError, apiJson } from '@/lib/api/auth';
import { getServiceSupabase } from '@/lib/db/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/expand?slug=...&link_id=...
 *
 * Bitly's `/v4/expand`: resolve a short link to its original destination.
 * Accepts either a slug or a full short URL in `link`.
 *
 * Deliberately reports existence but not secret material: `has_password` is a
 * boolean so a client can tell "protected, needs a password" from "no such
 * link", without the response ever revealing whether a particular guess is
 * closer to correct.
 */
export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'links:read');
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  let slug = params.get('slug') ?? '';
  const linkParam = params.get('link');

  // Accept a full short URL and reduce it to the slug, which is what a client
  // holding a copied link will send.
  if (!slug && linkParam) {
    try {
      const url = new URL(linkParam);
      slug = url.pathname.replace(/^\/+/, '');
    } catch {
      return apiError('invalid_request', 'link is not a valid URL.');
    }
  }

  slug = decodeURIComponent(slug).trim();
  if (!slug) {
    return apiError('invalid_request', 'Provide slug or link.');
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('expand_link', { p_slug: slug });

  if (error) {
    return apiError('server_error', 'Unable to expand link.');
  }

  const row = (Array.isArray(data) ? data : data ? [data] : [])[0] as
    | {
        id: string;
        slug: string;
        destination: string;
        title: string;
        created_at: string;
        is_active: boolean;
        expires_at: string | null;
        has_password: boolean;
      }
    | undefined;

  if (!row) {
    return apiError('not_found', 'Link not found.');
  }

  // A link that exists but is not currently serving must not present its
  // destination: an expired or disabled link returning a live target would
  // make `expand` a way to read data the visitor could not see.
  const expired = row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now();
  const serving = row.is_active && !expired;

  return apiJson({
    created_at: row.created_at,
    id: `${(process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/${row.slug}`,
    link: `${(process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/${row.slug}`,
    long_url: serving && !row.has_password ? row.destination : null,
    title: row.title,
    archived: !row.is_active,
    has_password: row.has_password,
    // Explicit rather than leaving the caller to infer it from a null long_url.
    status: serving ? (row.has_password ? 'protected' : 'active') : expired ? 'expired' : 'inactive'
  });
}

/** Kept for parity with the other v1 routes that export POST for OPTIONS use. */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}