/**
 * QR code listing for the management screen.
 *
 * Lives in lib/ rather than in the page component for two reasons.
 *
 * The page body would otherwise call `Date.now()` while rendering, which the
 * React compiler rules correctly flag as impure — and silencing that would be
 * wrong, because the fix is structural, not a pragma.
 *
 * It also keeps the page component to "fetch a view model, render it", which is
 * what the other pages in this project already do.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';
import { qrExpiration, type QrExpiration } from './content';

export interface StudioLink {
  id: string;
  slug: string;
  title: string;
  destination_url: string;
}

export interface StudioCode {
  id: string;
  title: string;
  kind: 'dynamic' | 'static';
  expiresAt: string | null;
  archived: boolean;
  expiration: QrExpiration;
  target: string;
}

export interface QrListing {
  links: StudioLink[];
  codes: StudioCode[];
}

export async function loadQrListing(ownerId: string, now = Date.now()): Promise<QrListing> {
  const supabase = getServiceSupabase();

  const [linksRes, codesRes] = await Promise.all([
    supabase
      .from('links')
      .select('id, slug, title, destination_url')
      .eq('created_by', ownerId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('qr_codes')
      .select('id,title,kind,link_id,destination_url,expires_at,archived')
      .eq('created_by', ownerId)
      .order('created_at', { ascending: false })
      .limit(100)
  ]);

  const links = (linksRes.data ?? []) as StudioLink[];
  const linkById = new Map(links.map((l) => [l.id, l]));

  const codes: StudioCode[] = (codesRes.data ?? []).map((row) => {
    const r = row as {
      id: string;
      title: string;
      kind: 'dynamic' | 'static';
      link_id: string | null;
      destination_url: string | null;
      expires_at: string | null;
      archived: boolean;
    };

    return {
      id: r.id,
      title: r.title,
      kind: r.kind,
      expiresAt: r.expires_at,
      archived: r.archived,
      expiration: qrExpiration(r, now),
      target:
        r.kind === 'static'
          ? 'Static content'
          : (r.link_id ? linkById.get(r.link_id)?.title : r.destination_url) ?? '—'
    };
  });

  return { links, codes };
}