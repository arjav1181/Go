import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { recordScan, resolveScanTarget } from '@/lib/qr/scans';
import type { QrCodeRow } from '@/lib/qr/content';

export const dynamic = 'force-dynamic';

/**
 * GET /scan/{qrId}
 *
 * The destination a managed QR code encodes. Records the scan, then hands the
 * visitor to wherever the code resolves.
 *
 * Redirecting to the *short link* rather than to the link's destination
 * directly is deliberate: the link's own routing — schedule windows, weighted
 * variants, the password gate — has to keep working for a code printed on paper
 * that nobody can re-point.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('qr_codes')
    .select('id,kind,link_id,destination_url,content,slug,expires_at,archived')
    .eq('id', id)
    .maybeSingle();

  if (!data) return new NextResponse('Not found', { status: 404 });

  const row = data as unknown as QrCodeRow;
  const target = await resolveScanTarget(row);

  if (!target.ok) {
    // The visitor still gets a real page rather than a bare status code: an
    // expired code on a poster should explain itself.
    return new NextResponse(expiredPage(target.message), {
      status: target.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow, noarchive'
      }
    });
  }

  after(() =>
    recordScan({
      qrId: id,
      linkId: row.link_id,
      countryCode: request.headers.get('x-vercel-ip-country')
    })
  );

  return NextResponse.redirect(target.to, {
    status: 302,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function expiredPage(message: string): string {
  const safe = message.replace(/[<>&]/g, '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow,noarchive" />
<title>Code unavailable</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;color:#000;display:grid;place-items:center;min-height:100vh;padding:1.5rem}
@media (prefers-color-scheme:dark){body{background:#000;color:#ededed}}
main{max-width:22rem;text-align:center}
h1{font-size:1.0625rem;font-weight:600;margin:0 0 .375rem}
p{color:#666;font-size:.8125rem;line-height:1.6;margin:0}
@media (prefers-color-scheme:dark){p{color:#a1a1a1}}
</style></head>
<body><main><h1>Code unavailable</h1><p>${safe}</p></main></body></html>`;
}
