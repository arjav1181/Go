'use server';

import { revalidatePath } from 'next/cache';
import { assertOwner } from '@/lib/auth/owner';
import { validateLabel, parseUuid, TAG_MAX, FOLDER_MAX } from '@/lib/tags/validation';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import {
  createTag,
  createFolder,
  deleteTag,
  deleteFolder,
  findTagByName,
  findFolderByName
} from '@/lib/tags/repo';

export interface TagActionResult {
  ok: boolean;
  message: string;
}

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Create a tag. Names are unique per owner. */
export async function createTagAction(
  _prev: TagActionResult,
  formData: FormData
): Promise<TagActionResult> {
  const owner = await assertOwner();

  const validated = validateLabel(getString(formData, 'name'), TAG_MAX, 'tag');
  if (!validated.ok) return { ok: false, message: validated.error };

  if (await findTagByName(owner.id, validated.name)) {
    return { ok: false, message: `Tag "${validated.name}" already exists.` };
  }

  const created = await createTag(owner.id, validated.name);
  if (!created) return { ok: false, message: 'Unable to create tag.' };

  revalidatePath('/dashboard');
  revalidatePath('/tags');
  return { ok: true, message: `Created tag "${validated.name}".` };
}

/** Create a folder, optionally nested under an existing folder. */
export async function createFolderAction(
  _prev: TagActionResult,
  formData: FormData
): Promise<TagActionResult> {
  const owner = await assertOwner();

  const validated = validateLabel(getString(formData, 'name'), FOLDER_MAX, 'folder');
  if (!validated.ok) return { ok: false, message: validated.error };

  const rawParent = formData.get('parent_id');
  let parentId: string | null = null;
  if (typeof rawParent === 'string' && rawParent !== '') {
    parentId = parseUuid(rawParent);
    if (!parentId) return { ok: false, message: 'Invalid parent folder.' };
    // The parent must belong to this owner.
    if (!(await assertOwnedFolder(owner.id, parentId))) {
      return { ok: false, message: 'Invalid parent folder.' };
    }
  }

  if (await findFolderByName(owner.id, validated.name)) {
    return { ok: false, message: `Folder "${validated.name}" already exists.` };
  }

  const created = await createFolder(owner.id, validated.name, parentId);
  if (!created) return { ok: false, message: 'Unable to create folder.' };

  revalidatePath('/dashboard');
  revalidatePath('/tags');
  return { ok: true, message: `Created folder "${validated.name}".` };
}

/**
 * Delete a tag. Links are preserved: only join rows cascade away.
 * Ownership is verified explicitly so a crafted id cannot delete another
 * owner's tag.
 */
export async function deleteTagAction(tagId: string): Promise<void> {
  const owner = await assertOwner();
  if (!parseUuid(tagId)) throw new Error('Invalid tag id.');
  if (!(await assertOwnedTag(owner.id, tagId))) throw new Error('Unauthorized');

  await deleteTag(tagId);
  revalidatePath('/dashboard');
  revalidatePath('/tags');
}

/** Delete a folder. Child folders are detached (parent set to null), not deleted. */
export async function deleteFolderAction(folderId: string): Promise<void> {
  const owner = await assertOwner();
  if (!parseUuid(folderId)) throw new Error('Invalid folder id.');
  if (!(await assertOwnedFolder(owner.id, folderId))) throw new Error('Unauthorized');

  await deleteFolder(folderId);
  revalidatePath('/dashboard');
  revalidatePath('/tags');
}

async function assertOwnedTag(ownerId: string, tagId: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('tags')
    .select('id')
    .eq('id', tagId)
    .eq('created_by', ownerId)
    .maybeSingle();
  return Boolean(data);
}

async function assertOwnedFolder(ownerId: string, folderId: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from('folders')
    .select('id')
    .eq('id', folderId)
    .eq('created_by', ownerId)
    .maybeSingle();
  return Boolean(data);
}