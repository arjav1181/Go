import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getOwnerOrNull } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { claimUnownedLinks } from '@/lib/links/ownership';
import { checkRateLimit, policyFor, callerKeyFromHeaders } from '@/lib/ratelimit/limiter';
import { logEvent, EVENTS } from '@/lib/log';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const owner = await getOwnerOrNull();
  if (!owner) return new NextResponse('Unauthorized', { status: 401 });

  // QR rendering is CPU-bound; cap it so it cannot be used as a compute sink.
  const limit = await checkRateLimit(
    policyFor('qr', callerKeyFromHeaders(_request.headers))
  );
  if (!limit.allowed) {
    logEvent(EVENTS.qrRateLimited, 'warn', {});
    return new NextResponse('Too many QR requests.', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds) }
    });
  }

  const { id } = await params;
  await claimUnownedLinks(owner.id);

  const supabase = getServiceSupabase();
  const { data: link } = await supabase
    .from('links')
    .select('slug')
    .eq('id', id)
    .eq('created_by', owner.id)
    .maybeSingle();

  if (!link) return new NextResponse('Not found', { status: 404 });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const shortUrl = `${appUrl}/${link.slug}`;

  try {
    const buffer = await QRCode.toBuffer(shortUrl, { width: 512, margin: 2 });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow'
      }
    });
  } catch {
    return new NextResponse('Unable to generate QR code.', { status: 500 });
  }
}