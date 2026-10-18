/**
 * QR scan recording.
 *
 * The gap this closes
 * -------------------
 * Migration 0012 created `qr_daily_stats` and `increment_qr_scan`, and its
 * comment described link-backed codes filing scans under a reserved referrer.
 * Nothing implemented it: a managed code encoded the short URL, so a scan was
 * an ordinary redirect counted as an ordinary click. `increment_qr_scan` had no
 * caller anywhere in the codebase.
 *
 * That is not a cosmetic gap. The spec treats scans and clicks as different
 * events appearing under different referrer labels, and a poster's QR code has
 * meaningfully different traffic from the same link shared as a URL. Counting a
 * scan as a click makes the numbers quietly wrong rather than obviously broken.
 *
 * How a scan is identified
 * ------------------------
 * A managed code encodes `/scan/<qrId>` rather than the short link itself. That
 * handler records the scan and then redirects to the short link, so the link's
 * own routing — schedules, weighted variants, expiry, password gate — still
 * applies exactly as it would have without the code in front of it.
 *
 * The alternative, detecting a scan by its referrer, is not possible: a scan is
 * optical and sends no Referer header, so the request is indistinguishable from
 * direct traffic. Bitly solves the same problem by resolving managed codes
 * through its own endpoint.
 *
 * Attribution
 * -----------
 *   link-backed  counted against the link under the reserved "Bitly QR Code"
 *                referrer, so it lands in the existing analytics cube under the
 *                documented label.
 *   standalone   counted in `qr_daily_stats`, since there is no link row to
 *                attribute it to.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';
import { safeHttpUrl } from '../pages/blocks';
import { resolveQrContent, type QrCodeRow } from './content';

export { SCAN_REFERRER } from '../pages/analytics';

/** Path a managed QR code encodes, so the scan is attributable. */
export function scanPath(qrId: string): string {
  return `/scan/${encodeURIComponent(qrId)}`;
}

/** Resolve where a scanner should be sent, without recording anything. */
export async function resolveScanTarget(
  row: QrCodeRow
): Promise<{ ok: true; to: string } | { ok: false; status: 404 | 409 | 410; message: string }> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  // Managed code: go through the short link so its routing still applies.
  if (row.kind === 'dynamic' && row.link_id) {
    if (!row.slug) {
      return { ok: false, status: 404, message: 'Attached link no longer exists.' };
    }
    return { ok: true, to: `${base}/${row.slug}` };
  }

  // Everything else is a plain payload and must be handed over untouched.
  const resolved = await resolveQrContent(row);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status as 404 | 409 | 410, message: resolved.message };
  }
  const url = safeHttpUrl(resolved.content);
  if (!url) {
    return { ok: false, status: 404, message: 'QR code has no scannable destination.' };
  }
  return { ok: true, to: url };
}

/**
 * Record one scan.
 *
 * Fire-and-forget: someone standing in front of a poster must be redirected
 * whether or not the counter works, and a failing analytics write must never
 * surface as an error to a visitor.
 */
export async function recordScan(input: {
  qrId: string;
  /** Set when the code is attached to a managed link. */
  linkId?: string | null;
  countryCode?: string | null;
}): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const supabase = getServiceSupabase();

    if (!input.linkId) {
      await supabase.rpc('increment_qr_scan', {
        p_qr_code_id: input.qrId,
        p_day: day,
        p_referrer_host: '',
        p_device_category: ''
      });
      return;
    }

    /**
     * Link-backed codes go through `recordClick` with the reserved referrer so
     * they share the analytics cube with ordinary clicks. The import is dynamic
     * because `record-click` reaches the settings cache, and this module is
     * imported by the image/listing paths that have no need for it.
     */
    const { recordClick } = await import('@/lib/analytics/record-click');
    const { SCAN_REFERRER } = await import('@/lib/pages/analytics');
    await recordClick({
      linkId: input.linkId,
      referrer: null,
      userAgent: null,
      syntheticReferrer: SCAN_REFERRER,
      countryCode: input.countryCode ?? null
    });
  } catch {
    // A failed counter must never block the redirect.
  }
}