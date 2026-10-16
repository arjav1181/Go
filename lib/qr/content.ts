/**
 * What a QR code actually encodes.
 *
 * Kept separate from rendering because the answer differs per code kind and the
 * rules are behavioural, not visual:
 *
 *   dynamic + link  -> the owner's short URL, so changing the link's
 *                      destination later changes where the printed code goes.
 *                      This is the whole point of a managed code (spec 06).
 *
 *   dynamic + url   -> the destination as given.
 *
 *   static          -> the raw content, immutable after creation.
 *
 * Expiry is enforced here rather than in the renderer so a static or URL-backed
 * code reports the documented behaviour: once expired the code stops working and
 * reports its own expiry, it does not keep resolving.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseCustomizations,
  type QrCustomizations,
  type ErrorCorrectionLevel
} from './customizations';

export interface QrCodeRow {
  kind: 'dynamic' | 'static';
  link_id: string | null;
  destination_url: string | null;
  content: string | null;
  slug?: string | null;
  expires_at: string | null;
  archived: boolean;
}

export type ResolveResult =
  | { ok: true; content: string; errorCorrection: ErrorCorrectionLevel }
  | { ok: false; status: 404 | 410 | 409; message: string };

const FALLBACK_APP_URL = 'http://localhost:3000';

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? FALLBACK_APP_URL).replace(/\/$/, '');
}

/**
 * Load a code row with its link slug when it has one.
 *
 * Split out so the caller controls the Supabase client and tests can pass a row
 * straight to `resolveQrContent` without touching the database.
 */
export async function resolveQrContent(
  row: QrCodeRow,
  errorCorrection: ErrorCorrectionLevel = 'M'
): Promise<ResolveResult> {
  if (row.archived) {
    return { ok: false, status: 409, message: 'This QR code is archived.' };
  }

  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 410, message: 'This QR code has expired.' };
  }

  if (row.kind === 'static') {
    if (!row.content) {
      return { ok: false, status: 404, message: 'QR code has no content.' };
    }
    return { ok: true, content: row.content, errorCorrection };
  }

  if (row.link_id) {
    if (!row.slug) {
      return { ok: false, status: 404, message: 'Attached link no longer exists.' };
    }
    return { ok: true, content: `${appBase()}/${row.slug}`, errorCorrection };
  }

  if (row.destination_url) {
    return { ok: true, content: row.destination_url, errorCorrection };
  }

  return { ok: false, status: 404, message: 'QR code has no destination.' };
}

/**
 * Fetch a code and resolve its payload, joining `links` when needed.
 *
 * The join is optional: migration 0012 must be applied before this works, and
 * the select is kept narrow on purpose.
 */
export async function loadAndResolve(
  supabase: SupabaseClient,
  id: string,
  ownerId: string
): Promise<ResolveResult & { customizations?: QrCustomizations }> {
  const { data } = await supabase
    .from('qr_codes')
    .select('id,kind,link_id,destination_url,content,expires_at,archived,customizations,links!left(slug)')
    .eq('id', id)
    .eq('created_by', ownerId)
    .maybeSingle();

  if (!data) return { ok: false, status: 404, message: 'QR code not found.' };

  const row = data as Record<string, unknown>;
  const customizations = parseCustomizations(row.customizations).value;

  // PostgREST returns an embedded one-to-one as an object; normalise defensively
  // in case the join shape differs.
  const embedded = row.links as unknown;
  const linkRow =
    embedded && typeof embedded === 'object' && !Array.isArray(embedded)
      ? (embedded as Record<string, unknown>)
      : null;

  const resolved = await resolveQrContent(
    {
      kind: row.kind as 'dynamic' | 'static',
      link_id: (row.link_id as string | null) ?? null,
      destination_url: (row.destination_url as string | null) ?? null,
      content: (row.content as string | null) ?? null,
      slug: (linkRow?.slug as string | null) ?? null,
      expires_at: (row.expires_at as string | null) ?? null,
      archived: Boolean(row.archived)
    },
    customizations.errorCorrection
  );

  return resolved.ok ? { ...resolved, customizations } : resolved;
}
/**
 * Expiry vocabulary for the QR list (spec section 16: "expired, expiring, no
 * expiration date").
 *
 * Lives here rather than inline in the page component for two reasons: the
 * labels belong with the rest of the QR domain rules, and computing them in the
 * component means calling `Date.now()` during render, which the React compiler
 * rules correctly flag as impure.
 */
export type QrExpiration = 'active' | 'expired' | 'expiring' | 'none' | 'archived';

/** Within this window a code is shown as "expiring" rather than merely active. */
export const EXPIRING_SOON_DAYS = 7;

export function qrExpiration(
  row: { expires_at: string | null; archived: boolean },
  now: number
): QrExpiration {
  if (row.archived) return 'archived';
  if (!row.expires_at) return 'none';
  const at = new Date(row.expires_at).getTime();
  if (at <= now) return 'expired';
  if (at - now <= EXPIRING_SOON_DAYS * 86_400_000) return 'expiring';
  return 'active';
}
