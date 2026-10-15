import { getServiceSupabase } from '@/lib/db/supabase-server';

export type Tag = { id: string; name: string; created_at: string };
export type Folder = { id: string; name: string; parent_id: string | null; created_at: string };

export type LinkWithRelations = {
  id: string;
  slug: string;
  destination_url: string;
  title: string | null;
  notes: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  tag_ids: string[];
  folder_ids: string[];
};

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** All tags owned by this owner, alphabetically. */
export async function listTags(ownerId: string): Promise<Tag[]> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('tags')
    .select('id, name, created_at')
    .eq('created_by', ownerId)
    .order('name', { ascending: true });
  return (data ?? []) as Tag[];
}

export async function listFolders(ownerId: string): Promise<Folder[]> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('folders')
    .select('id, name, parent_id, created_at')
    .eq('created_by', ownerId)
    .order('name', { ascending: true });
  return (data ?? []) as Folder[];
}

/**
 * Look up a tag by normalized name for this owner.
 * Returns null when absent. Used to create-or-reuse during link saves.
 */
export async function findTagByName(ownerId: string, name: string): Promise<Tag | null> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('tags')
    .select('id, name, created_at')
    .eq('created_by', ownerId)
    .eq('name', name)
    .maybeSingle();
  return (data as Tag | null) ?? null;
}

export async function findFolderByName(ownerId: string, name: string): Promise<Folder | null> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('folders')
    .select('id, name, parent_id, created_at')
    .eq('created_by', ownerId)
    .eq('name', name)
    .maybeSingle();
  return (data as Folder | null) ?? null;
}

export async function createTag(ownerId: string, name: string): Promise<Tag | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('tags')
    .insert({ name, created_by: ownerId })
    .select('id, name, created_at')
    .single();
  if (error) return null;
  return data as Tag;
}

export async function createFolder(
  ownerId: string,
  name: string,
  parentId: string | null
): Promise<Folder | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('folders')
    .insert({ name, parent_id: parentId, created_by: ownerId })
    .select('id, name, parent_id, created_at')
    .single();
  if (error) return null;
  return data as Folder;
}

/**
 * Replace a link's tag/folder assignments.
 *
 * `on delete cascade` on the join tables means links themselves are never
 * deleted when a tag or folder is removed.
 */
export async function setLinkTags(linkId: string, tagIds: string[]): Promise<void> {
  const supabase = getServiceSupabase();
  await supabase.from('link_tags').delete().eq('link_id', linkId);
  const unique = [...new Set(tagIds)];
  if (unique.length > 0) {
    await supabase.from('link_tags').insert(unique.map((tag_id) => ({ link_id: linkId, tag_id })));
  }
}

export async function setLinkFolders(linkId: string, folderIds: string[]): Promise<void> {
  const supabase = getServiceSupabase();
  await supabase.from('link_folders').delete().eq('link_id', linkId);
  const unique = [...new Set(folderIds)];
  if (unique.length > 0) {
    await supabase
      .from('link_folders')
      .insert(unique.map((folder_id) => ({ link_id: linkId, folder_id })));
  }
}

export async function deleteTag(tagId: string): Promise<void> {
  const supabase = getServiceSupabase();
  await supabase.from('tags').delete().eq('id', tagId);
}

export async function deleteFolder(folderId: string): Promise<void> {
  const supabase = getServiceSupabase();
  await supabase.from('folders').delete().eq('id', folderId);
}

/** Batch-load tag/folder ids for a set of links (avoids N+1 queries). */
export async function getRelationsForLinks(linkIds: string[]): Promise<
  Map<string, { tag_ids: string[]; folder_ids: string[] }>
> {
  const result = new Map<string, { tag_ids: string[]; folder_ids: string[] }>();
  if (linkIds.length === 0) return result;

  const supabase = getServiceSupabase();

  const { data: linkTags } = await supabase
    .from('link_tags')
    .select('link_id, tag_id')
    .in('link_id', linkIds);

  const { data: linkFolders } = await supabase
    .from('link_folders')
    .select('link_id, folder_id')
    .in('link_id', linkIds);

  for (const id of linkIds) result.set(id, { tag_ids: [], folder_ids: [] });
  for (const row of linkTags ?? []) {
    result.get(row.link_id)?.tag_ids.push(row.tag_id);
  }
  for (const row of linkFolders ?? []) {
    result.get(row.link_id)?.folder_ids.push(row.folder_id);
  }
  return result;
}

/**
 * Reduce a client-supplied id list to the ids actually owned by this owner.
 *
 * Tag/folder ids arrive from a form, so they are untrusted input: without this
 * an owner could attach another owner's tag by guessing its id.
 */
export async function filterOwnedTagIds(ownerId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('tags')
    .select('id')
    .eq('created_by', ownerId)
    .in('id', unique);
  return (data ?? []).map((row) => row.id);
}

export async function filterOwnedFolderIds(ownerId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('folders')
    .select('id')
    .eq('created_by', ownerId)
    .in('id', unique);
  return (data ?? []).map((row) => row.id);
}

/**
 * Create-or-reuse tags by name, returning their ids.
 * Invalid names are skipped rather than failing the whole link save.
 */
export async function resolveTagNames(ownerId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const existing = await findTagByName(ownerId, name);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const created = await createTag(ownerId, name);
    if (created) ids.push(created.id);
  }
  return [...new Set(ids)];
}

/** Create-or-reuse folders by name, returning their ids. */
export async function resolveFolderNames(ownerId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const existing = await findFolderByName(ownerId, name);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const created = await createFolder(ownerId, name, null);
    if (created) ids.push(created.id);
  }
  return [...new Set(ids)];
}