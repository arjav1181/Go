'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { assertOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { planForOwner, countLinkCreates, checkQuota } from '@/lib/tenancy/quota';
import {
  validateCustomSlug,
  normalizeDestinationUrl,
  shortHostFromAppUrl,
  linkInputSchema,
  parseIdList
} from '@/lib/links/validation';
import { validateLabel, normalizeLabel, TAG_MAX, FOLDER_MAX } from '@/lib/tags/validation';
import {
  setLinkTags,
  setLinkFolders,
  filterOwnedTagIds,
  filterOwnedFolderIds,
  resolveTagNames,
  resolveFolderNames
} from '@/lib/tags/repo';
import { generateRandomSlug } from '@/lib/links/slug';
import { checkRateLimit, policyFor } from '@/lib/ratelimit/limiter';
import { logEvent, EVENTS } from '@/lib/log';

interface ActionResult {
  ok: boolean;
  message: string;
  linkId?: string;
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function parseExpiry(input: string): { ok: true; value: string | null } | { ok: false } {
  if (input.trim() === '') return { ok: true, value: null };
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, value: date.toISOString() };
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

const shortHost = shortHostFromAppUrl(process.env.NEXT_PUBLIC_APP_URL);

type ParsedForm =
  | {
      ok: true;
      destinationUrl: string;
      slugRaw: string;
      title: string;
      notes: string;
      expiresAt: string | null;
    }
  | { ok: false; message: string };

function parseLinkForm(formData: FormData): ParsedForm {
  const parsed = linkInputSchema.safeParse({
    destination_url: getString(formData, 'destination_url'),
    slug: getString(formData, 'slug'),
    title: getString(formData, 'title'),
    notes: getString(formData, 'notes'),
    expires_at: getString(formData, 'expires_at')
  });
  if (!parsed.success) {
    return { ok: false, message: 'Please check the form values and try again.' };
  }

  const dest = normalizeDestinationUrl(parsed.data.destination_url, shortHost);
  if (!dest.ok) return { ok: false, message: dest.error };

  const expires = parseExpiry(parsed.data.expires_at ?? '');
  if (!expires.ok) return { ok: false, message: 'Expiration must be a valid date and time.' };

  return {
    ok: true,
    destinationUrl: dest.url,
    slugRaw: (parsed.data.slug ?? '').trim(),
    title: (parsed.data.title ?? '').trim(),
    notes: (parsed.data.notes ?? '').trim(),
    expiresAt: expires.value
  };
}

/**
 * Split a comma/newline separated free-text field into normalized labels,
 * dropping anything that fails validation.
 */
function parseNewLabels(input: string, max: number, kind: 'tag' | 'folder'): string[] {
  const parts = input
    .split(/[,\n]/)
    .map((part) => normalizeLabel(part))
    .filter((part) => part !== '');

  const labels: string[] = [];
  for (const part of parts) {
    const validated = validateLabel(part, max, kind);
    if (validated.ok && !labels.includes(validated.name)) labels.push(validated.name);
  }
  return labels;
}

/**
 * Resolve the tag/folder assignment for a link.
 *
 * Combines checked existing ids with any newly typed names, then filters the
 * ids down to what this owner actually owns so a crafted id cannot attach
 * another owner's tag.
 */
async function resolveRelations(
  ownerId: string,
  formData: FormData
): Promise<{ tagIds: string[]; folderIds: string[] }> {
  const ownedTagIds = await filterOwnedTagIds(ownerId, parseIdList(formData, 'tag_ids'));
  const ownedFolderIds = await filterOwnedFolderIds(ownerId, parseIdList(formData, 'folder_ids'));

  const newTagNames = parseNewLabels(getString(formData, 'new_tags'), TAG_MAX, 'tag');
  const newFolderNames = parseNewLabels(getString(formData, 'new_folders'), FOLDER_MAX, 'folder');

  const createdTagIds = newTagNames.length ? await resolveTagNames(ownerId, newTagNames) : [];
  const createdFolderIds = newFolderNames.length
    ? await resolveFolderNames(ownerId, newFolderNames)
    : [];

  return {
    tagIds: [...new Set([...ownedTagIds, ...createdTagIds])],
    folderIds: [...new Set([...ownedFolderIds, ...createdFolderIds])]
  };
}

export async function createLink(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const owner = await assertOwner();

  // Keyed on the owner id: there is no public sign-up, so this bounds abuse by
  // a compromised or over-eager owner account.
  const limit = await checkRateLimit(policyFor('linkCreate', owner.id));
  if (!limit.allowed) {
    logEvent(EVENTS.linkCreateRejected, 'warn', { reason: 'rate_limited' });
    return {
      ok: false,
      message: 'Too many links created recently. Please wait before creating more.'
    };
  }

  const parsed = parseLinkForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  let slug: string;
  if (parsed.slugRaw === '') {
    slug = generateRandomSlug();
  } else {
    const validated = validateCustomSlug(parsed.slugRaw);
    if (!validated.ok) return { ok: false, message: validated.error };
    slug = validated.slug;
  }

  const supabase = getServiceSupabase();

  /**
   * Quota gate, before anything is written.
   *
   * Checked here rather than only in the UI so it holds for the API and the CSV
   * importer too — a plan limit enforced by a form is not a plan limit.
   *
   * Fails open: `countLinkCreates` returns null when the count cannot be read,
   * and `checkQuota` treats that as allowance. A missing quota check is an
   * accounting error; the same refusal on the permission check would be a
   * security hole, so the two deliberately fail in opposite directions.
   */
  const plan = await planForOwner(owner.id);
  const used = await countLinkCreates(owner.id);
  if (used !== null) {
    const decision = checkQuota(plan, 'link_create', used);
    if (!decision.allowed) {
      return {
        ok: false,
        message: decision.reason ?? 'Monthly link limit reached for your plan.'
      };
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? slug : generateRandomSlug();
    const { data, error } = await supabase
      .from('links')
      .insert({
        slug: candidate,
        destination_url: parsed.destinationUrl,
        title: parsed.title === '' ? null : parsed.title,
        notes: parsed.notes === '' ? null : parsed.notes,
        expires_at: parsed.expiresAt,
        is_active: true,
        created_by: owner.id
      })
      .select('id')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        if (parsed.slugRaw === '') continue;
        return { ok: false, message: 'That slug is already in use.' };
      }
      return { ok: false, message: 'Unable to create link.' };
    }

    const relations = await resolveRelations(owner.id, formData);
    await setLinkTags(data.id, relations.tagIds);
    await setLinkFolders(data.id, relations.folderIds);

    logEvent(EVENTS.linkCreated, 'info', { owner: owner.id });
    revalidatePath('/dashboard');
    redirect(`/links/${data.id}`);
  }

  return { ok: false, message: 'Unable to generate a unique slug. Try again.' };
}

export async function updateLink(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const owner = await assertOwner();

  const limit = await checkRateLimit(policyFor('linkEdit', owner.id));
  if (!limit.allowed) {
    return { ok: false, message: 'Too many edits recently. Please wait a moment.' };
  }

  const parsed = parseLinkForm(formData);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const isActive = getString(formData, 'is_active') === 'true';

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('links')
    .update({
      destination_url: parsed.destinationUrl,
      title: parsed.title === '' ? null : parsed.title,
      notes: parsed.notes === '' ? null : parsed.notes,
      expires_at: parsed.expiresAt,
      is_active: isActive
    })
    .eq('id', id);

  if (error) return { ok: false, message: 'Unable to update link.' };

  const relations = await resolveRelations(owner.id, formData);
  await setLinkTags(id, relations.tagIds);
  await setLinkFolders(id, relations.folderIds);

  revalidatePath('/dashboard');
  revalidatePath(`/links/${id}`);
  return { ok: true, message: 'Link updated.' };
}

export async function toggleLink(id: string, nextActive: boolean): Promise<void> {
  await assertOwner();
  const supabase = getServiceSupabase();
  const { error } = await supabase.from('links').update({ is_active: nextActive }).eq('id', id);
  if (error) throw new Error('Unable to update link.');
  revalidatePath('/dashboard');
  revalidatePath(`/links/${id}`);
}

export async function deleteLink(id: string): Promise<void> {
  await assertOwner();
  const supabase = getServiceSupabase();
  const { error } = await supabase.from('links').delete().eq('id', id);
  if (error) throw new Error('Unable to delete link.');
  revalidatePath('/dashboard');
  redirect('/dashboard');
}
