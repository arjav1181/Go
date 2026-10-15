'use server';

import { revalidatePath } from 'next/cache';
import { assertOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { generateApiKey } from '@/lib/api/keys';
import { validateLabel } from '@/lib/tags/validation';
import { FOLDER_MAX } from '@/lib/tags/validation';
import { parseScopes, describeScopes } from '@/lib/api/scopes';

export interface KeyActionResult {
  ok: boolean;
  message: string;
  /** Returned once, at creation only. Never stored or shown again. */
  newKey?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Issue an API key. The plaintext key is returned exactly once. */
export async function createApiKeyAction(
  _prev: KeyActionResult,
  formData: FormData
): Promise<KeyActionResult> {
  const owner = await assertOwner();

  const name = validateLabel(getString(formData, 'name'), FOLDER_MAX, 'folder');
  if (!name.ok) return { ok: false, message: name.error.replace('Folder name', 'Key name') };

  const scopes = parseScopes(getString(formData, 'scopes'));

  const { key, hash, prefix } = generateApiKey();
  const supabase = getServiceSupabase();

  const { error } = await supabase.from('api_keys').insert({
    name: name.name,
    key_hash: hash,
    key_prefix: prefix,
    created_by: owner.id,
    owner_email: owner.email ?? '',
    scopes: scopes.join(',')
  });

  if (error) return { ok: false, message: 'Unable to create API key.' };

  revalidatePath('/settings');
  return {
    ok: true,
    message: `API key created with scopes: ${describeScopes(scopes)}. Copy it now — it will not be shown again.`,
    newKey: key
  };
}

/**
 * Rotate a key: issue a replacement with the same scopes, then revoke the old
 * one. The replacement is returned exactly once, like any new key.
 */
export async function rotateApiKeyAction(keyId: string): Promise<KeyActionResult> {
  const owner = await assertOwner();
  if (!UUID_RE.test(keyId)) return { ok: false, message: 'Invalid key id.' };

  const supabase = getServiceSupabase();
  const { data: existing } = await supabase
    .from('api_keys')
    .select('id, name, scopes')
    .eq('id', keyId)
    .eq('created_by', owner.id)
    .is('revoked_at', null)
    .maybeSingle();

  if (!existing) return { ok: false, message: 'Key not found.' };

  const scopes = parseScopes(existing.scopes);
  const { key, hash, prefix } = generateApiKey();

  const { data: created, error } = await supabase
    .from('api_keys')
    .insert({
      name: existing.name,
      key_hash: hash,
      key_prefix: prefix,
      created_by: owner.id,
      owner_email: owner.email ?? '',
      scopes: scopes.join(','),
      rotated_from: existing.id
    })
    .select('id')
    .single();

  if (error || !created) return { ok: false, message: 'Unable to rotate key.' };

  // Revoke the old key only after the replacement exists.
  await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', existing.id)
    .eq('created_by', owner.id);

  revalidatePath('/settings');
  return {
    ok: true,
    message: 'Key rotated. The previous key is now revoked.',
    newKey: key
  };
}

/** Revoke a key. Revocation is immediate and irreversible. */
export async function revokeApiKeyAction(keyId: string): Promise<void> {
  const owner = await assertOwner();
  if (!UUID_RE.test(keyId)) throw new Error('Invalid key id.');

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('created_by', owner.id);

  if (error) throw new Error('Unable to revoke API key.');

  revalidatePath('/settings');
}