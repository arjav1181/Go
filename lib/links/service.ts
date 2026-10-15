import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  validateCustomSlug,
  normalizeDestinationUrl,
  shortHostFromAppUrl
} from '@/lib/links/validation';
import { generateRandomSlug } from '@/lib/links/slug';

const shortHost = shortHostFromAppUrl(process.env.NEXT_PUBLIC_APP_URL);

export type LinkInput = {
  destination_url: string;
  slug?: string | null;
  title?: string | null;
  notes?: string | null;
  expires_at?: string | null;
};

export type CreateLinkResult =
  | { ok: true; link: { id: string; slug: string; destination_url: string } }
  | { ok: false; error: string };

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function parseExpiry(input: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  if (input === null || input === undefined || String(input).trim() === '') {
    return { ok: true, value: null };
  }
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, value: date.toISOString() };
}

/**
 * Create a link.
 *
 * Shared by the dashboard form and the public API so both enforce identical
 * slug, destination and expiry rules.
 */
export async function createLinkRecord(
  ownerId: string,
  input: LinkInput
): Promise<CreateLinkResult> {
  const destination = normalizeDestinationUrl(input.destination_url ?? '', shortHost);
  if (!destination.ok) return { ok: false, error: destination.error };

  const expiry = parseExpiry(input.expires_at);
  if (!expiry.ok) return { ok: false, error: 'Expiration must be a valid date and time.' };

  let slug: string;
  const rawSlug = (input.slug ?? '').trim();
  if (rawSlug === '') {
    slug = generateRandomSlug();
  } else {
    const validated = validateCustomSlug(rawSlug);
    if (!validated.ok) return { ok: false, error: validated.error };
    slug = validated.slug;
  }

  const title = (input.title ?? '').trim();
  const notes = (input.notes ?? '').trim();

  const supabase = getServiceSupabase();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? slug : generateRandomSlug();
    const { data, error } = await supabase
      .from('links')
      .insert({
        slug: candidate,
        destination_url: destination.url,
        title: title === '' ? null : title,
        notes: notes === '' ? null : notes,
        expires_at: expiry.value,
        is_active: true,
        created_by: ownerId
      })
      .select('id, slug, destination_url')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        if (rawSlug === '') continue;
        return { ok: false, error: 'That slug is already in use.' };
      }
      return { ok: false, error: 'Unable to create link.' };
    }

    return { ok: true, link: data as { id: string; slug: string; destination_url: string } };
  }

  return { ok: false, error: 'Unable to generate a unique slug. Try again.' };
}

/** Resolve a client-supplied id to a link owned by `ownerId`. */
export async function findOwnedLink(ownerId: string, id: string): Promise<{ id: string } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('links')
    .select('id')
    .eq('id', id)
    .eq('created_by', ownerId)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}