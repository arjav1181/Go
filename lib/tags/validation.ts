import { z } from 'zod';

export const TAG_MAX = 32;
export const FOLDER_MAX = 64;

export const tagRegex = /^[a-z0-9][a-z0-9 _-]*$/;

export type NameValidation = { ok: true; name: string } | { ok: false; error: string };

/**
 * Tags/folders are stored lowercase so filtering and uniqueness are predictable.
 * Input is trimmed and collapsed to single spaces before validation.
 */
export function normalizeLabel(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function validateLabel(raw: string, max: number, kind: 'tag' | 'folder'): NameValidation {
  const name = normalizeLabel(raw);
  const label = kind === 'tag' ? 'Tag' : 'Folder';

  if (name === '') return { ok: false, error: `${label} name is required.` };
  if (name.length > max) return { ok: false, error: `${label} name must be at most ${max} characters.` };
  if (!tagRegex.test(name)) {
    return {
      ok: false,
      error: `${label} name must start with a letter or number and may contain letters, numbers, spaces, hyphens and underscores.`
    };
  }
  return { ok: true, name };
}

export const tagInputSchema = z.object({
  name: z.string().min(1),
  parent_id: z.string().uuid().nullable().optional()
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a UUID coming from client input.
 *
 * Ids arrive from forms, so they are untrusted; anything that is not a
 * well-formed UUID is rejected before it reaches a query.
 */
export function parseUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}