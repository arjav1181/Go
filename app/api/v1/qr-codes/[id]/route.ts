import { NextResponse } from 'next/server';
import { getOwnerOrNull } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { checkRateLimit, policyFor, callerKeyFromHeaders } from '@/lib/ratelimit/limiter';
import { logEvent, EVENTS } from '@/lib/log';
import {
  renderQrImage,
  renderStaticImage,
  isImageFormat,
  contentDisposition,
  QR_CONTENT_TYPES,
  type ImageFormat
} from '@/lib/qr/render';
import { parseCustomizations, defaultCustomizations } from '@/lib/qr/customizations';
import { resolveQrContent } from '@/lib/qr/content';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/qr-codes/{id}
 * GET /api/v1/qr-codes/{id}/image
 *
 * Mirrors Bitly's retrieve-resource and retrieve-image endpoints. The image
 * variant selects format via the `format` query parameter or the `Accept`
 * header, and honours the documented static-vs-managed customisation split.
 */
async function load(ownerId: string, id: string) {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('qr_codes')
    .select('*')
    .eq('id', id)
    .eq('created_by', ownerId)
    .maybeSingle();
  return data ?? null;
}

export async function GET(request: Request, { params }: RouteParams) {
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

  const { id } = await params;
  const url = new URL(request.url);
  const wantsImage = url.pathname.endsWith('/image');

  const row = await load(owner.id, id);
  if (!row) {
    return NextResponse.json({ error: { message: 'QR code not found.' } }, { status: 404 });
  }

  const customizations = parseCustomizations(row.customizations).value;

  if (!wantsImage) {
    return NextResponse.json(
      {
        id: row.id,
        title: row.title,
        kind: row.kind,
        link_id: row.link_id,
        destination_url: row.destination_url,
        content: row.content,
        customizations,
        archived: row.archived,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const resolved = await resolveQrContent(row, customizations.errorCorrection);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: { message: resolved.message } },
      { status: resolved.status }
    );
  }

  // `format` wins; otherwise honour an Accept header that names one.
  const requested = url.searchParams.get('format');
  const format: ImageFormat = isImageFormat(requested)
    ? requested
    : formatFromAccept(request.headers.get('accept') ?? '') ?? 'png';

  try {
    if (row.kind === 'static') {
      const { buffer, downgraded } = await renderStaticImage(resolved.content, customizations, {
        format,
        width: Number(url.searchParams.get('width')) || undefined
      });
      return image(buffer, format, downgraded);
    }
    const buffer = await renderQrImage(resolved.content, {
      format,
      width: Number(url.searchParams.get('width')) || undefined,
      dark: customizations.dotPatternColor,
      light: customizations.backgroundColor,
      errorCorrection: customizations.errorCorrection
    });
    return image(buffer, format, []);
  } catch {
    return NextResponse.json(
      { error: { message: 'Unable to generate QR code.' } },
      { status: 500 }
    );
  }
}

function image(buffer: Buffer, format: ImageFormat, downgraded: string[]): NextResponse {
  const headers: Record<string, string> = {
    'Content-Type': QR_CONTENT_TYPES[format],
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow'
  };
  if (downgraded.length) headers['X-QR-Downgraded'] = downgraded.join(',');
  void contentDisposition(format);
  return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
}

function formatFromAccept(accept: string): 'png' | 'jpeg' | 'svg' | null {
  const a = accept.toLowerCase();
  // Checked most-specific first: `image/*` and `*/*` must not win.
  if (a.includes('image/svg+xml')) return 'svg';
  if (a.includes('image/jpeg')) return 'jpeg';
  if (a.includes('image/png')) return 'png';
  return null;
}

export const dynamic = 'force-dynamic';

/** Re-exported so tests can import the default without a live request. */
export const _defaultCustomizations = defaultCustomizations;