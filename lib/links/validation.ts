import { z } from 'zod';

export const SLUG_MIN = 3;
export const SLUG_MAX = 64;

export const slugRegex = /^[a-z0-9_-]+$/;

/**
 * Slugs that may never be claimed, because the application already serves a
 * route at that path.
 *
 * Next.js resolves a static segment before a dynamic one, so a link created
 * with a reserved slug would be unreachable: `/tags` would serve the dashboard
 * instead of redirecting. The link would appear to work and never fire.
 *
 * `tests/reserved-routes.test.ts` asserts that every real route in `app/` is
 * covered here, so adding a page without reserving its slug fails the build.
 */
export const RESERVED_SLUGS = new Set([
  // Application routes
  'api', 'auth', 'dashboard', 'links', 'login', 'logout', 'new', 'privacy',
  'settings', 'tags', 'terms',
  // System and infrastructure
  'admin', 'callback', 'cron', 'docs', 'favicon', 'health', 'icon',
  'manifest', 'opengraph-image', 'ready', 'robots', 'sitemap', 'static',
  'public', 'www',
  // Framework internals
  '_next'
]);

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; error: string };

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function validateCustomSlug(raw: string): SlugValidation {
  const slug = normalizeSlug(raw);
  if (slug === '') return { ok: false, error: 'Slug is required when provided.' };
  if (slug.length < SLUG_MIN) return { ok: false, error: `Slug must be at least ${SLUG_MIN} characters.` };
  if (slug.length > SLUG_MAX) return { ok: false, error: `Slug must be at most ${SLUG_MAX} characters.` };
  if (!slugRegex.test(slug)) return { ok: false, error: 'Slug may only contain lowercase letters, numbers, hyphens and underscores.' };
  if (slug.startsWith('-') || slug.startsWith('_') || slug.endsWith('-') || slug.endsWith('_')) {
    return { ok: false, error: 'Slug cannot start or end with a hyphen or underscore.' };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: 'That slug is reserved.' };
  return { ok: true, slug };
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export type DestinationValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

export function normalizeDestinationUrl(raw: string, shortHost?: string): DestinationValidation {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: 'Destination URL is required.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a valid absolute URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// destinations are allowed.' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, error: 'Destination URL must not contain credentials.' };
  }
  if (/\s/.test(trimmed) || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, error: 'Destination URL contains invalid characters.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (shortHost && host === shortHost.toLowerCase()) {
    return { ok: false, error: 'Destination must not point back to this short-link host.' };
  }
  return { ok: true, url: parsed.toString() };
}

export function shortHostFromAppUrl(appUrl: string | undefined): string | undefined {
  if (!appUrl) return undefined;
  try {
    return new URL(appUrl).hostname;
  } catch {
    return undefined;
  }
}

export const linkInputSchema = z.object({
  destination_url: z.string().min(1),
  slug: z.string().optional(),
  title: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
  expires_at: z.string().optional(),
  tag_ids: z.array(z.string().uuid()).optional(),
  folder_ids: z.array(z.string().uuid()).optional()
});

/** Parse repeated checkbox values from a form into a de-duplicated id list. */
export function parseIdList(formData: FormData, key: string): string[] {
  const values = formData.getAll(key);
  const ids = values.filter((value): value is string => typeof value === 'string');
  return [...new Set(ids)];
}
