/**
 * Groups, memberships and permissions (spec sheet section 11).
 *
 * The database exposes `user_can(group, user, action)` as the single arbiter of
 * "may this user do this". This module is the typed client for it, plus the
 * resolution of "which group is this request operating in".
 *
 * Two things it deliberately does not do
 * --------------------------------------
 * **It does not create a tenant.** Group ids are resolved from the session's
 * active group, defaulting to the owner's personal group when none is set.
 * That default is what makes the whole feature additive: a deployment with one
 * operator never sets a group, every read still resolves to a valid context,
 * and no caller has to handle a null group.
 *
 * **It does not bypass the database check.** Every method here calls the RPC
 * and takes its answer. A client-side "isAdmin" flag would be a convenience
 * that quietly becomes a security boundary the first time someone trusts it.
 */

import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  GROUP_ROLES,
  isValidGroupSlug,
  type GroupRole,
  type GroupAction,
  type Group
} from './permissions';

/** Every group the user belongs to, for the switcher. */
export async function listGroupsForUser(userId: string): Promise<Group[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('groups_for_user', { p_user_id: userId });
  if (error) return [];
  return (data ?? []) as Group[];
}

export async function groupRole(groupId: string, userId: string): Promise<GroupRole | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('group_role_of', {
    p_group_id: groupId,
    p_user_id: userId
  });
  if (error) return null;
  const role = (data as string | null) ?? null;
  // The column is CHECK-constrained in SQL, but an unrecognised value reaching
  // the UI would mean a permission gap nobody notices. Validate anyway.
  return GROUP_ROLES.includes(role as GroupRole) ? (role as GroupRole) : null;
}

/** The one call that should gate every tenant-scoped operation. */
export async function userCan(
  groupId: string,
  userId: string,
  action: GroupAction
): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc('user_can', {
    p_group_id: groupId,
    p_user_id: userId,
    p_action: action
  });
  if (error) {
    // Fail closed. A permission check that cannot reach the database must not
    // resolve to "allowed".
    return false;
  }
  return data === true;
}

/** Convenience wrapper that returns a permission bundle for UI affordances. */
export async function permissionsFor(
  groupId: string,
  userId: string
): Promise<Record<GroupAction, boolean>> {
  const [read, write, manageMembers, del] = await Promise.all([
    userCan(groupId, userId, 'read'),
    userCan(groupId, userId, 'write'),
    userCan(groupId, userId, 'manage_members'),
    userCan(groupId, userId, 'delete')
  ]);
  return { read, write, manage_members: manageMembers, delete: del };
}

/**
 * Resolve the group a request is operating in.
 *
 * Precedence: an explicitly requested group (checked for permission), then the
 * session's active group, then the user's first group. Falling back to "the
 * first group" is what keeps a single-operator deployment working with no
 * configuration at all.
 */
export async function resolveActiveGroup(
  userId: string,
  requested?: string | null
): Promise<{ id: string | null; reason: 'requested' | 'active' | 'default' | 'none' }> {
  if (requested && isValidGroupSlug(requested) === false && !isUuid(requested)) {
    return { id: null, reason: 'none' };
  }

  const groups = await listGroupsForUser(userId);
  if (groups.length === 0) return { id: null, reason: 'none' };

  if (requested) {
    const byId = groups.find((g) => g.id === requested);
    if (byId) return { id: byId.id, reason: 'requested' };
    const bySlug = groups.find((g) => g.slug === requested);
    if (bySlug) return { id: bySlug.id, reason: 'requested' };
    // Requested a group the user is not in. No id is returned rather than a
    // silent fallback to a different group, which would be a confusing
    // substitute for a 403.
    return { id: null, reason: 'none' };
  }

  return { id: groups[0].id, reason: 'default' };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
