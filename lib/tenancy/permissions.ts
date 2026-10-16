/**
 * Group permission vocabulary and the pure rules around it.
 *
 * Split from `groups.ts` because that module imports the Supabase server client,
 * which uses the `@/` path alias that Node's runtime resolver cannot resolve.
 * Anything the unit suite exercises has to live in a module with no such
 * import, so the constants and pure functions sit here and the database calls
 * live beside them.
 *
 * Roles are deliberately coarse. The spec defers the detailed permission matrix
 * to the subscription and account setup, so a finer model here would be guessing
 * at a contract rather than implementing one.
 */

export const GROUP_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export type GroupAction = 'read' | 'write' | 'manage_members' | 'delete';

export interface Group {
  id: string;
  name: string;
  slug: string;
  description?: string;
  archived?: boolean;
  role?: GroupRole;
}

/** Spec limit: 150 groups per account. Mirrors the trigger in 0016. */
export const MAX_GROUPS_PER_ACCOUNT = 150;

export const SLUG_PATTERN = /^[a-z0-9_-]{3,64}$/;

export function isValidGroupSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value);
}

/**
 * Slugify a group name.
 *
 * Returns null rather than a lossy fallback: a name that reduces to nothing
 * usable ("日本語") should be rejected at the form rather than silently
 * becoming a group with no addressable slug.
 */
export function slugifyGroupName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return isValidGroupSlug(slug) ? slug : null;
}

/**
 * Every link must belong to a group before group filtering can be relied on.
 * Until that is true, scoping a query by group silently hides rows that have a
 * NULL group_id — which is every row created before 0016.
 */
export function scopeToGroup<T extends { group_id?: string | null }>(
  rows: T[],
  groupId: string | null
): T[] {
  if (!groupId) return rows;
  return rows.filter((r) => r.group_id === null || r.group_id === groupId);
}

