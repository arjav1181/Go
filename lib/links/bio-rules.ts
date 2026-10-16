/**
 * Pure rules for bio pages.
 *
 * Kept apart from `bio.ts` on purpose: this module has no imports at all, so it
 * can be unit-tested without a database or a Supabase client, and so the
 * validation that guards a *public* page cannot drift behind data access.
 */

export const BIO_HANDLE_PATTERN = /^[a-z0-9_-]{3,32}$/;

/** Handles that would collide with an application route. */
export const RESERVED_HANDLES = new Set([
  'api', 'login', 'logout', 'dashboard', 'links', 'new', 'settings',
  'privacy', 'terms', 'docs', 'admin', 'auth', 'callback', 'tags',
  'health', 'ready', 'robots', 'sitemap', 'cron'
]);

export type BioTheme = 'minimal' | 'card' | 'grid';

export const BIO_THEMES: BioTheme[] = ['minimal', 'card', 'grid'];

export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle);
}

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateHandle(
  raw: string
): { ok: true; handle: string } | { ok: false; error: string } {
  const handle = normalizeHandle(raw);
  if (handle === '') return { ok: false, error: 'Handle is required.' };
  if (!BIO_HANDLE_PATTERN.test(handle)) {
    return {
      ok: false,
      error: 'Use 3–32 characters: lowercase letters, numbers, hyphen or underscore.'
    };
  }
  if (isReservedHandle(handle)) return { ok: false, error: 'That handle is reserved.' };
  return { ok: true, handle };
}

/**
 * Only http/https destinations are ever rendered as an href on a public page.
 *
 * A bio page is the one place owner-supplied URLs are shown to strangers
 * without authentication, so this is the chokepoint that keeps `javascript:`
 * and `data:` out of the rendered markup.
 */
export function safeBioHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** An accent colour must be a literal hex triple, or nothing else is honoured. */
export function safeAccentColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0070f3';
}

export function validateTheme(value: string): BioTheme | null {
  return (BIO_THEMES as string[]).includes(value) ? (value as BioTheme) : null;
}