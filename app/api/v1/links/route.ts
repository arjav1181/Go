import { authorizeApiRequest, apiError, apiJson } from '@/lib/api/auth';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { createLinkRecord } from '@/lib/links/service';

export const dynamic = 'force-dynamic';

/** Maximum accepted request body. Anything larger is rejected unread. */
export const MAX_BODY_BYTES = 8_192;

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const declared = request.headers.get('content-length');
    if (declared && Number(declared) > MAX_BODY_BYTES) return null;

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;

    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** GET /api/v1/links — list links owned by the authenticated key. */
export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'links:read');
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 200)
    : 100;

  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('links')
      .select('id, slug, destination_url, title, is_active, expires_at, created_at')
      .eq('created_by', auth.ownerId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return apiError('server_error', 'Unable to list links.');

    const links = (data ?? []).map((link) => ({
      ...link,
      short_url: `${appUrl()}/${link.slug}`
    }));

    return apiJson({ links, count: links.length });
  } catch {
    return apiError('server_error', 'Unable to list links.');
  }
}

/** POST /api/v1/links — create a link. */
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'links:write');
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  if (!body) {
    return apiError('invalid_request', `Invalid JSON body (max ${MAX_BODY_BYTES} bytes).`);
  }

  const result = await createLinkRecord(auth.ownerId, {
    destination_url: typeof body.destination_url === 'string' ? body.destination_url : '',
    slug: typeof body.slug === 'string' ? body.slug : null,
    title: typeof body.title === 'string' ? body.title : null,
    notes: typeof body.notes === 'string' ? body.notes : null,
    expires_at: typeof body.expires_at === 'string' ? body.expires_at : null
  });

  if (!result.ok) return apiError('invalid_request', result.error);

  return apiJson({ link: { ...result.link, short_url: `${appUrl()}/${result.link.slug}` } }, 201);
}
