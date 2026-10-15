import { authorizeApiRequest, apiError, apiJson } from '@/lib/api/auth';
import { appUrl, MAX_BODY_BYTES } from '../route';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { findOwnedLink } from '@/lib/links/service';
import { normalizeDestinationUrl, shortHostFromAppUrl } from '@/lib/links/validation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Small JSON body guard, shared policy with the collection route. */
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

/** PATCH /api/v1/links/:id — update a link owned by the key. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApiRequest(request, 'links:write');
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const owned = await findOwnedLink(auth.ownerId, id);
  if (!owned) return apiError('not_found', 'Link not found.');

  const body = await readJson(request);
  if (!body) return apiError('invalid_request', `Invalid JSON body (max ${MAX_BODY_BYTES} bytes).`);

  const patch: Record<string, unknown> = {};
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
  if (typeof body.title === 'string') patch.title = body.title.trim() || null;
  if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null;

  // Destination and expiry reuse the same validation as the UI.
  if (typeof body.destination_url === 'string') {
    const normalized = normalizeDestinationUrl(
      body.destination_url,
      shortHostFromAppUrl(process.env.NEXT_PUBLIC_APP_URL)
    );
    if (!normalized.ok) return apiError('invalid_request', normalized.error);
    patch.destination_url = normalized.url;
  }

  if (typeof body.expires_at === 'string') {
    const raw = body.expires_at.trim();
    if (raw === '') {
      patch.expires_at = null;
    } else {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return apiError('invalid_request', 'Expiration must be a valid date and time.');
      patch.expires_at = date.toISOString();
    }
  }

  if (Object.keys(patch).length === 0) return apiError('invalid_request', 'No supported fields to update.');

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('links')
    .update(patch)
    .eq('id', id)
    .eq('created_by', auth.ownerId)
    .select('id, slug, destination_url, title, is_active, expires_at')
    .single();

  if (error) return apiError('server_error', 'Unable to update link.');

  return apiJson({ link: { ...data, short_url: `${appUrl()}/${data.slug}` } });
}

/** DELETE /api/v1/links/:id — delete a link owned by the key. */
export async function DELETE(request: Request, context: RouteContext) {
  const auth = await authorizeApiRequest(request, 'links:write');
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const owned = await findOwnedLink(auth.ownerId, id);
  if (!owned) return apiError('not_found', 'Link not found.');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('links')
    .delete()
    .eq('id', id)
    .eq('created_by', auth.ownerId);

  if (error) return apiError('server_error', 'Unable to delete link.');

  return new Response(null, { status: 204 });
}