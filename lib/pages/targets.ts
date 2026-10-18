/**
 * Resolving link-backed page blocks to real destinations.
 *
 * The block schema allows a `linkId` instead of a raw `href`, so a page button
 * points at one of the owner's links rather than a URL copied at edit time. That
 * is the better model — editing the link later updates the page automatically —
 * but it means the renderer cannot produce an href from the block alone.
 *
 * Until this existed, a link-backed block rendered as an inert "Unlinked" box:
 * the block was valid, the schema accepted it, and the public page showed
 * something broken. So linkIds are resolved here, in one batched query, before
 * rendering.
 *
 * Batching matters. Resolving per block would be N round trips for an N-block
 * page, on the request path, for every visitor.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';
import type { PageBlock } from './blocks';

export type ResolvedTargets = Map<string, string>;

/**
 * Fill in `href` for every block that carries a `linkId`.
 *
 * A link that has since been deleted, disabled or expired resolves to nothing
 * and the block is left without an href, which the renderer then omits. That is
 * the correct outcome: a page must not keep pointing at a destination the owner
 * has retired.
 *
 * Expired and inactive links are excluded deliberately — the redirect route
 * refuses to serve them, so advertising them on a page would send people to a
 * 410.
 */
export async function resolveBlockTargets(blocks: PageBlock[]): Promise<ResolvedTargets> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'link' && block.linkId && !block.href) ids.add(block.linkId);
  }

  const resolved: ResolvedTargets = new Map();
  if (ids.size === 0) return resolved;

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('links')
    .select('id, slug, destination_url, is_active, expires_at')
    .in('id', [...ids]);

  if (error) return resolved;

  const now = Date.now();
  for (const row of data ?? []) {
    const r = row as {
      id: string;
      slug: string;
      destination_url: string;
      is_active: boolean;
      expires_at: string | null;
    };
    if (!r.is_active) continue;
    if (r.expires_at && new Date(r.expires_at).getTime() <= now) continue;
    resolved.set(r.id, r.destination_url);
  }

  return resolved;
}

/**
 * Apply resolved targets to a block list.
 *
 * Returns new block objects rather than mutating, because the block list is
 * passed down through several components that memo on identity.
 */
export function applyTargets(blocks: PageBlock[], targets: ResolvedTargets): PageBlock[] {
  if (targets.size === 0) return blocks;
  return blocks.map((block) => {
    if (block.type !== 'link' || !block.linkId || block.href) return block;
    const href = targets.get(block.linkId);
    if (!href) return block;
    return { ...block, href };
  });
}