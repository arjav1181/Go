import { NextResponse } from 'next/server';
import { getOwnerOrNull } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { checkRateLimit, policyFor, callerKeyFromHeaders } from '@/lib/ratelimit/limiter';
import { logEvent, EVENTS } from '@/lib/log';
import { parseCustomizations, DEFAULT_CUSTOMIZATIONS } from '@/lib/qr/customizations';
import { planForOwner, countQrCreates, checkQuota } from '@/lib/tenancy/quota';

export const dynamic = 'force-dynamic';

const MAX_TITLE = 200;

function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: { message, details } }, { status: 400 });
}

/**
 * POST /api/v1/qr-codes
 *
 * Create a managed QR Code resource, matching Bitly's `POST /v4/qr-codes`.
 * Exactly one target must be supplied: an existing link, a destination URL, or
 * raw content for a static code.
 */
export async function POST(request: Request) {
  const owner = await getOwnerOrNull();
  if (!owner) return new NextResponse('Unauthorized', { status: 401 });

  const limit = await checkRateLimit(
    policyFor('qr', callerKeyFromHeaders(request.headers))
  );
  if (!limit.allowed) {
    logEvent(EVENTS.qrRateLimited, 'warn', {});
    return NextResponse.json(
      { error: { message: 'Too many QR requests.' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('Body must be valid JSON.');
  }

  const linkId = typeof body.link_id === 'string' ? body.link_id : null;
  const destinationUrl = typeof body.destination_url === 'string' ? body.destination_url : null;
  const content = typeof body.content === 'string' ? body.content : null;

  const targets = [linkId, destinationUrl, content].filter((t) => t !== null);
  if (targets.length === 0) {
    return badRequest(
      'One of link_id, destination_url or content is required.',
      'A QR code needs exactly one target.'
    );
  }
  if (targets.length > 1) {
    return badRequest(
      'Only one of link_id, destination_url or content may be supplied.',
      'A QR code needs exactly one target.'
    );
  }

  const kind = content !== null ? 'static' : 'dynamic';

  if (kind === 'dynamic' && destinationUrl !== null) {
    // Reuse the same destination rules as link creation rather than accepting
    // anything the redirect route would later refuse to follow.
    const { normalizeDestinationUrl } = await import('@/lib/links/validation');
    const check = normalizeDestinationUrl(destinationUrl);
    if (!check.ok) {
      return badRequest('destination_url must be a valid http(s) URL.', {
        field: 'destination_url',
        reason: check.error
      });
    }
  }

  if (content !== null && content.length > 2048) {
    return badRequest('content must be 2048 characters or fewer.', { field: 'content' });
  }

  const title = typeof body.title === 'string' ? body.title.slice(0, MAX_TITLE) : '';

  let expiresAt: string | null = null;
  if (body.expires_at !== undefined && body.expires_at !== null) {
    const parsed = new Date(String(body.expires_at));
    if (Number.isNaN(parsed.getTime())) {
      return badRequest('expires_at must be an ISO-8601 timestamp.', { field: 'expires_at' });
    }
    expiresAt = parsed.toISOString();
  }

  const parsedCustomizations = parseCustomizations(body.render_customizations ?? body.customizations);

  /**
   * Quota gate. Same reasoning as link creation: enforced in the API rather
   * than the designer, so it cannot be bypassed by calling the endpoint
   * directly, and it fails open when the count cannot be read.
   */
  const plan = await planForOwner(owner.id);
  const qrUsed = await countQrCreates(owner.id);
  if (qrUsed !== null) {
    const decision = checkQuota(plan, 'qr_create', qrUsed);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: { message: decision.reason ?? 'Monthly QR code limit reached for your plan.' } },
        { status: 429 }
      );
    }
  }

  const supabase = getServiceSupabase();

  if (linkId !== null) {
    const { data: link } = await supabase
      .from('links')
      .select('id')
      .eq('id', linkId)
      .eq('created_by', owner.id)
      .maybeSingle();
    if (!link) {
      return NextResponse.json(
        { error: { message: 'Link not found.' } },
        { status: 404 }
      );
    }
  }

  const { data, error } = await supabase
    .from('qr_codes')
    .insert({
      created_by: owner.id,
      title,
      kind,
      link_id: linkId,
      destination_url: destinationUrl,
      content,
      customizations: parsedCustomizations.value,
      expires_at: expiresAt
    })
    .select('id,title,kind,link_id,destination_url,content,customizations,archived,expires_at,created_at')
    .single();

  if (error) {
    logEvent(EVENTS.qrRateLimited, 'error', { stage: 'qr_create' });
    return NextResponse.json(
      { error: { message: 'Unable to create QR code.' } },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      id: data.id,
      title: data.title,
      kind: data.kind,
      link_id: data.link_id,
      destination_url: data.destination_url,
      content: data.content,
      customizations: data.customizations ?? DEFAULT_CUSTOMIZATIONS,
      archived: data.archived,
      expires_at: data.expires_at,
      created_at: data.created_at,
      // Reported rather than silently dropped, so a client can tell a clean
      // create from one whose design fields were partly rejected.
      warnings: parsedCustomizations.errors
    },
    { status: 201 }
  );
}

/**
 * GET /api/v1/qr-codes
 *
 * Lists the owner's codes. Supports the spec's documented filters: created
 * date, code type, attached link, and expiry status.
 */
export async function GET(request: Request) {
  const owner = await getOwnerOrNull();
  if (!owner) return new NextResponse('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const p = url.searchParams;

  const supabase = getServiceSupabase();
  let query = supabase
    .from('qr_codes')
    .select('id,title,kind,link_id,destination_url,archived,expires_at,created_at')
    .eq('created_by', owner.id)
    .order('created_at', { ascending: false });

  const kind = p.get('kind');
  if (kind === 'dynamic' || kind === 'static') query = query.eq('kind', kind);

  const linkId = p.get('link_id');
  if (linkId) query = query.eq('link_id', linkId);

  const createdAfter = p.get('created_after');
  if (createdAfter) {
    const d = new Date(createdAfter);
    if (!Number.isNaN(d.getTime())) query = query.gte('created_at', d.toISOString());
  }

  const createdBefore = p.get('created_before');
  if (createdBefore) {
    const d = new Date(createdBefore);
    if (!Number.isNaN(d.getTime())) query = query.lte('created_at', d.toISOString());
  }

  const archived = p.get('archived');
  if (archived === 'true' || archived === 'false') query = query.eq('archived', archived === 'true');

  // Expired / expiring / no-expiration is computed rather than filterable in
  // SQL here; `expiration` narrows the result set in application code.
  const expiration = p.get('expiration');
  const soon = Date.now() + 7 * 24 * 60 * 60 * 1000;

  const { data, error } = await query.limit(500);

  if (error) {
    return NextResponse.json(
      { error: { message: 'Unable to list QR codes.' } },
      { status: 500 }
    );
  }

  let rows = data ?? [];
  if (expiration === 'expired') {
    rows = rows.filter((r) => r.expires_at !== null && new Date(r.expires_at).getTime() <= Date.now());
  } else if (expiration === 'expiring') {
    rows = rows.filter(
      (r) =>
        r.expires_at !== null &&
        new Date(r.expires_at).getTime() > Date.now() &&
        new Date(r.expires_at).getTime() <= soon
    );
  } else if (expiration === 'none') {
    rows = rows.filter((r) => r.expires_at === null);
  }

  return NextResponse.json(
    {
      codes: rows.map((r) => ({
        ...r,
        expiration: r.expires_at === null ? 'none' : new Date(r.expires_at).getTime() <= Date.now() ? 'expired' : 'active'
      })),
      count: rows.length
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}