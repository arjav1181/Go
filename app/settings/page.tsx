import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { createApiKeyAction, revokeApiKeyAction, rotateApiKeyAction } from '@/app/actions/api-keys';
import { CreateLabelForm } from '@/components/create-label-form';
import { BioPageForm } from '@/components/bio-page-form';
import { PageEditorPanel } from '@/components/page-editor-panel';
import { loadPageForEditor } from '@/app/actions/page-editor';
import { hasUnpublishedChanges } from '@/lib/pages/lifecycle';
import { DeleteLabelButton } from '@/components/delete-label-button';
import { SettingsForm } from '@/components/settings-form';
import { RotateKeyButton } from '@/components/rotate-key-button';
import { formatDate } from '@/lib/utils';
import { getOwnerSettings } from '@/lib/settings/repo';
import { computeCutoffDay, describeRetention } from '@/lib/retention/retention';
import { describeAggregation } from '@/lib/settings/aggregation';
import { saveSettingsAction } from '@/app/actions/settings';

export const metadata = {
  title: 'Settings',
  // Private: owner-only page. Never indexed, never followed.
  robots: { index: false, follow: false, nocache: true }
};

export default async function SettingsPage() {
  const owner = await requireOwner();
  const supabase = getServiceSupabase();
  const settings = await getOwnerSettings(owner.id);

  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at')
    .eq('created_by', owner.id)
    .order('created_at', { ascending: false });

  const activeKeys = (keys ?? []).filter((key) => !key.revoked_at);
  const revokedKeys = (keys ?? []).filter((key) => key.revoked_at);

  const { data: bioRow } = await supabase
    .from('bio_pages')
    .select(
      'id, handle, display_name, bio, avatar_url, theme, accent_color, is_published, draft_blocks, published_blocks'
    )
    .eq('created_by', owner.id)
    .maybeSingle();

  const siteUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  // Block editor state for the page, if one exists. Kept alongside the legacy
  // fixed-layout form below so an existing bio page still works unchanged.
  const pageEditor = bioRow
    ? await loadPageForEditor()
    : null;
  const pageUnpublished = bioRow
    ? hasUnpublishedChanges({
        ...(bioRow as unknown as Parameters<typeof hasUnpublishedChanges>[0]),
        draft_blocks: (bioRow as { draft_blocks: unknown }).draft_blocks,
        published_blocks: (bioRow as { published_blocks: unknown }).published_blocks
      })
    : false;

  const bio = {
    handle: (bioRow?.handle as string) ?? '',
    displayName: (bioRow?.display_name as string) ?? '',
    bio: (bioRow?.bio as string) ?? '',
    avatarUrl: (bioRow?.avatar_url as string) ?? '',
    theme: (bioRow?.theme as string) ?? 'minimal',
    accentColor: (bioRow?.accent_color as string) ?? '#0070f3',
    isPublished: (bioRow?.is_published as boolean) ?? false,
    siteUrl
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-[var(--muted)]">API access and alias domains.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">API keys</h2>
        <p className="text-sm text-[var(--muted)]">
          Keys authenticate the owner-only API. The full key is displayed once when created and is
          stored only as a SHA-256 hash, so it cannot be recovered afterwards. Removing an owner from{' '}
          <code>OWNER_EMAILS</code> immediately invalidates their keys.
        </p>

        <CreateLabelForm action={createApiKeyAction} label="API key" placeholder="ci pipeline" exposeKey withScopes />

        {activeKeys.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No active API keys.</p>
        ) : (
          <ul className="space-y-2">
            {activeKeys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{key.name}</span>
                  <span className="block font-mono text-xs text-[var(--muted)]">
                    {key.key_prefix}… · created {formatDate(key.created_at)}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    Scopes: {(key as { scopes?: string }).scopes ?? 'links:read'}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    Last used: {key.last_used_at ? formatDate(key.last_used_at) : 'never'}
                  </span>
                </span>
                <RotateKeyButton
                  name={key.name}
                  action={rotateApiKeyAction.bind(null, key.id)}
                />
                <DeleteLabelButton
                  label={`Revoke API key ${key.name}`}
                  action={revokeApiKeyAction.bind(null, key.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {revokedKeys.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-[var(--muted)]">
              {revokedKeys.length} revoked key(s)
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-[var(--muted)]">
              {revokedKeys.map((key) => (
                <li key={key.id}>
                  {key.name} ({key.key_prefix}…) — revoked {formatDate(key.revoked_at)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Retention &amp; aggregation</h2>
        <p className="text-sm text-[var(--muted)]">
          {describeRetention(settings.retention)}{' '}
          {settings.retention.enabled
            ? `Data from ${computeCutoffDay(settings.retention)} onward is kept.`
            : null}
        </p>
        <p className="text-sm text-[var(--muted)]">{describeAggregation(settings.aggregation)}</p>
        <p className="text-xs text-[var(--muted)]">
          Turning a dimension off stops storing that data from now on. It does not remove data
          already recorded — use retention to delete older rows.
        </p>

        <SettingsForm
          action={saveSettingsAction}
          retention={settings.retention}
          aggregation={settings.aggregation}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Alias domains</h2>
        <p className="text-sm text-[var(--muted)]">
          Extra hosts are disabled by default. Set <code>ALIAS_DOMAINS</code> in the environment to a
          comma-separated list to enable them, then clear it to turn the feature off again — no code
          change or migration required. DNS and TLS for those hosts are yours to configure; this
          application never changes DNS.
        </p>
      </section>

      <section className="mt-8">
        {pageEditor?.page ? (
        <PageEditorPanel
          pageId={pageEditor.page.id}
          initialBlocks={pageEditor.blocks as never[]}
          stats={pageEditor.stats}
          blockStats={pageEditor.blockStats}
          isPublished={pageEditor.page.is_published}
          hasUnpublished={pageUnpublished}
          handle={pageEditor.handle}
          publicUrl={`${siteUrl}/@${pageEditor.handle}`}
        />
      ) : null}

      <h2 className="text-lg font-semibold">Bio page (simple)</h2>
      <p className="text-sm text-[var(--muted)]">
        The basic profile form. The block editor above is the full version; this stays available
        because a page that has never been published through the editor keeps rendering with this
        layout.
      </p>

      <BioPageForm initial={bio} />
      </section>
    </div>
  );
}
