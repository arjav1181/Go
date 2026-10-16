'use server';

import { revalidatePath } from 'next/cache';

import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { hashLinkPassword, validateLinkPassword } from '@/lib/links/passwords';
import { normalizeCampaign } from '@/lib/links/campaigns';
import { validateHandle, isReservedHandle, normalizeHandle } from '@/lib/links/bio';
import { parseLinkImport, toLinkCsv, type ImportOutcome } from '@/lib/links/bulk';
import { validateCustomSlug, normalizeDestinationUrl } from '@/lib/links/validation';

export type BulkResult =
  | { ok: true; created: number; skipped: ImportOutcome[]; total: number }
  | { ok: false; error: string };

/**
 * Create many links from a CSV upload.
 *
 * Partial success is the whole point: the owner gets a precise list of what
 * failed and why, rather than a transaction that rolls back four hundred good
 * rows because of one duplicate slug.
 */
export async function importLinks(
  _prev: BulkResult | null,
  formData: FormData
): Promise<BulkResult> {
  const owner = await requireOwner();
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a CSV file to import.' };
  }

  const text = await file.text();
  const supabase = getServiceSupabase();

  const { data: existing } = await supabase
    .from('links')
    .select('slug')
    .eq('created_by', owner.id);
  const knownSlugs = new Set((existing ?? []).map((r) => (r as { slug: string }).slug));

  const parsed = parseLinkImport(text, knownSlugs);
  if (parsed.created.length === 0 && parsed.failed.length === 0) {
    return { ok: false, error: 'That file had no importable rows.' };
  }

  const seen = new Set<string>();
  const insertable: Array<Record<string, unknown>> = [];

  for (const row of parsed.created) {
    // Guard against duplicates *within* the same file as well as the database.
    if (seen.has(row.slug)) {
      parsed.failed.push({
        ok: false,
        line: 0,
        error: `Slug "${row.slug}" appears more than once in the file — skipped.`,
        raw: { slug: row.slug }
      });
      continue;
    }
    const slugCheck = validateCustomSlug(row.slug);
    if (!slugCheck.ok) {
      parsed.failed.push({ ok: false, line: 0, error: slugCheck.error, raw: { slug: row.slug } });
      continue;
    }

    let passwordHash: string | null = null;
    if (row.password) {
      const policy = validateLinkPassword(row.password);
      if (!policy.ok) {
        parsed.failed.push({
          ok: false,
          line: 0,
          error: `Password for "${row.slug}": ${policy.error}`,
          raw: { slug: row.slug }
        });
        continue;
      }
      passwordHash = hashLinkPassword(row.password);
    }

    seen.add(row.slug);
    insertable.push({
      slug: row.slug,
      destination_url: row.destinationUrl,
      title: row.title || null,
      campaign: row.campaign || null,
      password_hash: passwordHash,
      created_by: owner.id
    });
  }

  if (insertable.length > 0) {
    const { error } = await supabase.from('links').insert(insertable);
    if (error) {
      // A whole-batch failure is reported as such rather than pretending the
      // rows were created.
      return { ok: false, error: 'The import could not be written to the database.' };
    }
  }

  await supabase.from('link_imports').insert({
    filename: file.name.slice(0, 120),
    total_rows: parsed.total,
    created_rows: insertable.length,
    skipped_rows: parsed.failed.length,
    failed_rows: 0,
    created_by: owner.id
  });

  revalidatePath('/dashboard');
  revalidatePath('/links/import');

  return { ok: true, created: insertable.length, skipped: parsed.failed, total: parsed.total };
}

/**
 * Export the owner's links as a CSV that can be re-imported.
 *
 * Passwords are never included — only the fact that a link is protected.
 */
export async function exportLinksCsv(): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { data: links } = await supabase
    .from('links')
    .select('id, slug, destination_url, title, campaign, password_hash')
    .eq('created_by', owner.id)
    .order('created_at', { ascending: true });

  if (!links || links.length === 0) {
    return { ok: true, csv: toLinkCsv([]) };
  }

  const ids = links.map((l) => (l as { id: string }).id);
  const { data: relations } = await supabase
    .from('link_tags')
    .select('link_id, tag_id')
    .in('link_id', ids);

  const { data: tags } = await supabase.from('tags').select('id, name');
  const tagName = new Map((tags ?? []).map((t) => [(t as { id: string }).id, (t as { name: string }).name]));
  const tagsByLink = new Map<string, string[]>();
  for (const rel of relations ?? []) {
    const r = rel as { link_id: string; tag_id: string };
    const name = tagName.get(r.tag_id);
    if (!name) continue;
    tagsByLink.set(r.link_id, [...(tagsByLink.get(r.link_id) ?? []), name]);
  }

  return {
    ok: true,
    csv: toLinkCsv(
      links.map((raw) => {
        const link = raw as {
          id: string;
          slug: string;
          destination_url: string;
          title: string | null;
          campaign: string | null;
          password_hash: string | null;
        };
        return {
          slug: link.slug,
          destinationUrl: link.destination_url,
          title: link.title,
          campaign: link.campaign,
          isProtected: Boolean(link.password_hash),
          tags: tagsByLink.get(link.id) ?? []
        };
      })
    )
  };
}

export type BioPageResult = { ok: true } | { ok: false; error: string };

/** Create or update the owner's bio page. */
export async function saveBioPage(_prev: BioPageResult | null, formData: FormData): Promise<BioPageResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const rawHandle = String(formData.get('handle') ?? '');
  const handleCheck = validateHandle(rawHandle);
  if (!handleCheck.ok) return { ok: false, error: handleCheck.error };

  const displayName = String(formData.get('display_name') ?? '').trim();
  if (displayName === '') return { ok: false, error: 'Display name is required.' };
  if (displayName.length > 64) return { ok: false, error: 'Display name must be 64 characters or fewer.' };

  const accent = String(formData.get('accent_color') ?? '#0070f3');
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return { ok: false, error: 'Accent colour must be a hex value like #0070f3.' };

  const theme = String(formData.get('theme') ?? 'minimal');
  if (!['minimal', 'card', 'grid'].includes(theme)) return { ok: false, error: 'Unknown theme.' };

  const row = {
    handle: handleCheck.handle,
    display_name: displayName,
    bio: String(formData.get('bio') ?? '').slice(0, 280),
    avatar_url: String(formData.get('avatar_url') ?? '').slice(0, 300),
    theme,
    accent_color: accent,
    is_published: formData.get('is_published') === 'on',
    created_by: owner.id,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('bio_pages')
    .upsert(row, { onConflict: 'handle' });

  if (error) {
    // A handle collision is a user error, not a crash; say so plainly.
    if (error.code === '23505') {
      return { ok: false, error: `The handle "@${handleCheck.handle}" is already taken.` };
    }
    return { ok: false, error: 'The bio page could not be saved.' };
  }

  revalidatePath('/settings');
  return { ok: true };
}

export async function deleteBioPage(): Promise<void> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();
  await supabase.from('bio_pages').delete().eq('created_by', owner.id);
  revalidatePath('/settings');
}

export type LinkExtrasResult = { ok: true } | { ok: false; error: string };

/**
 * Update the newer per-link attributes in one call.
 *
 * Kept separate from `updateLink` because these are all optional and none of
 * them should be expressible as a form field that an attacker could append.
 */
export async function updateLinkExtras(
  id: string,
  formData: FormData
): Promise<LinkExtrasResult> {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();

  const { data: link } = await supabase
    .from('links')
    .select('id')
    .eq('id', id)
    .eq('created_by', owner.id)
    .maybeSingle();
  if (!link) return { ok: false, error: 'Link not found.' };

  const patch: Record<string, unknown> = {};

  const campaignResult = normalizeCampaign(
    formData.has('campaign') ? String(formData.get('campaign')) : null
  );
  if (!campaignResult.ok) return { ok: false, error: campaignResult.error };
  patch.campaign = campaignResult.campaign;

  patch.show_on_bio = formData.get('show_on_bio') === 'on';

  const bioOrderRaw = String(formData.get('bio_order') ?? '').trim();
  if (bioOrderRaw === '') {
    patch.bio_order = null;
  } else {
    const parsedOrder = Number.parseInt(bioOrderRaw, 10);
    if (!Number.isInteger(parsedOrder) || parsedOrder < 0 || parsedOrder > 999) {
      return { ok: false, error: 'Bio position must be a whole number between 0 and 999.' };
    }
    patch.bio_order = parsedOrder;
  }

  // An empty password field means "leave the current password alone"; clearing
  // is an explicit action so a stray keystroke cannot remove protection.
  const passwordRaw = String(formData.get('password') ?? '');
  if (passwordRaw !== '') {
    const policy = validateLinkPassword(passwordRaw);
    if (!policy.ok) return { ok: false, error: policy.error };
    patch.password_hash = hashLinkPassword(passwordRaw);
  }
  if (formData.get('clear_password') === 'on') {
    patch.password_hash = null;
  }

  const { error } = await supabase
    .from('links')
    .update(patch)
    .eq('id', id)
    .eq('created_by', owner.id);

  if (error) return { ok: false, error: 'Could not save those changes.' };

  revalidatePath('/dashboard');
  revalidatePath(`/links/${id}`);
  return { ok: true };
}

export { normalizeDestinationUrl, isReservedHandle, normalizeHandle };