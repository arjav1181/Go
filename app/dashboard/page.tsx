import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { AnalyticsPanel } from '@/components/analytics-panel';
import { StatusBadge } from '@/components/status-badge';
import { buildAnalytics } from '@/lib/analytics/queries';
import { listTags, listFolders, getRelationsForLinks } from '@/lib/tags/repo';
import { sanitizeSearchQuery } from '@/lib/links/search';
import { claimUnownedLinks } from '@/lib/links/ownership';

export const metadata = {
  title: 'Dashboard',
  // Private: owner-only page. Never indexed, never followed.
  robots: { index: false, follow: false, nocache: true }
};


type SearchParams = Promise<{ q?: string; tag?: string; range?: string; start?: string; end?: string }>;

/** Build the CSV export URL preserving the active filters. */
function exportHref(params: { range?: string; start?: string; end?: string; tag?: string }, format: string) {
  const search = new URLSearchParams();
  search.set('range', params.range ?? '30d');
  if (params.range === 'custom' && params.start && params.end) {
    search.set('start', params.start);
    search.set('end', params.end);
  }
  search.set('format', format);
  return `/api/export/clicks?${search.toString()}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const owner = await requireOwner();
  const resolved = await searchParams;
  const rawQuery = (resolved?.q ?? '').trim();
  const activeTagId = resolved?.tag ?? '';

  // Adopt links created before owner tracking existed so they are not lost.
  await claimUnownedLinks(owner.id);

  const tags = await listTags(owner.id);
  const activeTag = tags.find((tag) => tag.id === activeTagId);

  const supabase = getServiceSupabase();

  let linksQuery = supabase
    .from('links')
    .select('id, slug, destination_url, title, is_active, expires_at, created_at')
    .eq('created_by', owner.id)
    .order('created_at', { ascending: false });

  const safeQuery = sanitizeSearchQuery(rawQuery);
  if (safeQuery) {
    linksQuery = linksQuery.or(`slug.ilike.%${safeQuery}%,title.ilike.%${safeQuery}%`);
  }

  const { data: links } = await linksQuery;
  let visible = links ?? [];

  // Tag filtering happens after the base query so tag ids stay owner-scoped.
  let visibleIds = visible.map((link) => link.id);
  if (activeTagId) {
    const { data: tagged } = await supabase
      .from('link_tags')
      .select('link_id')
      .eq('tag_id', activeTagId);
    const taggedIds = new Set((tagged ?? []).map((row) => row.link_id));
    visible = visible.filter((link) => taggedIds.has(link.id));
    visibleIds = visible.map((link) => link.id);
  }

  const [analytics, relations] = await Promise.all([
    buildAnalytics({
      linkIds: visibleIds,
      preset: resolved?.range,
      start: resolved?.start,
      end: resolved?.end
    }),
    getRelationsForLinks(visibleIds)
  ]);

  const folders = await listFolders(owner.id);
  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const now = new Date();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-7 px-5 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-heading-24">Links</h1>
          <p className="mt-0.5 text-[13px] text-[var(--ds-gray-900)]">
            Manage your short links and view aggregate clicks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={exportHref({ range: resolved?.range, start: resolved?.start, end: resolved?.end }, 'granular')}
            className="btn btn-secondary"
          >
            Export detail
          </a>
          <a
            href={exportHref({ range: resolved?.range, start: resolved?.start, end: resolved?.end }, 'daily')}
            className="btn btn-secondary"
          >
            Export daily
          </a>
          <Link href="/links/new" className="btn btn-primary">
            New link
            <kbd className="rounded border border-current/20 px-1 font-mono text-[10px] opacity-70">n</kbd>
          </Link>
        </div>
      </div>

      <form method="get" action="/dashboard" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={rawQuery}
          placeholder="Search by slug or title…"
          aria-label="Search links by slug or title"
          className="input flex-1 sm:max-w-sm"
        />
        {activeTag ? <input type="hidden" name="tag" value={activeTag.id} /> : null}
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[13px] text-[var(--ds-gray-900)]">Filter</span>
          <Link
            href="/dashboard"
            aria-current={activeTag ? undefined : 'page'}
            className={
              activeTag
                ? 'rounded-md border border-[var(--ds-gray-400)] px-2.5 py-1 text-label-13 text-secondary transition-colors hover:text-[var(--ds-gray-1000)]'
                : 'rounded-md border border-[var(--ds-gray-500)] bg-[var(--ds-background-200)] px-2.5 py-1 text-[12px] font-medium text-[var(--ds-gray-1000)]'
            }
          >
            All
          </Link>
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/dashboard?tag=${tag.id}`}
              aria-current={tag.id === activeTagId ? 'page' : undefined}
              className={
                tag.id === activeTagId
                  ? 'rounded-md border border-[var(--ds-gray-500)] bg-[var(--ds-background-200)] px-2.5 py-1 text-[12px] font-medium text-[var(--ds-gray-1000)]'
                  : 'rounded-md border border-[var(--ds-gray-400)] px-2.5 py-1 text-label-13 text-secondary transition-colors hover:text-[var(--ds-gray-1000)]'
              }
            >
              {tag.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--ds-gray-400)]">
        <table className="w-full text-[13px]">
          <thead className="bg-[var(--ds-background-200)] text-left text-label-12 uppercase tracking-[0.04em] text-tertiary">
            <tr>
              <th scope="col" className="px-5 py-2.5 text-label-13 font-medium">Slug / title</th>
              <th scope="col" className="px-5 py-2.5 text-label-13 font-medium">Destination</th>
              <th scope="col" className="px-5 py-2.5 text-label-13 font-medium">State</th>
              <th scope="col" className="px-5 py-2.5 text-label-13 font-medium">Organisation</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Clicks</th>
              <th scope="col" className="px-5 py-2.5 text-label-13 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-16 text-center">
                  <p className="text-[14px] font-medium">
                    {rawQuery || activeTag ? 'No matches' : 'No links yet'}
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--ds-gray-900)]">
                    {rawQuery || activeTag
                      ? 'No links match this search or filter.'
                      : 'Create your first short link to get started.'}
                  </p>
                </td>
              </tr>
            ) : null}
            {visible.map((link) => {
              const rel = relations.get(link.id) ?? { tag_ids: [], folder_ids: [] };
              const linkTags = tags.filter((tag) => rel.tag_ids.includes(tag.id));
              const linkFolders = folders.filter((folder) => rel.folder_ids.includes(folder.id));
              return (
                <tr key={link.id} className="border-t border-[var(--ds-gray-400)] align-top transition-colors hover:bg-[var(--ds-background-200)]">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/links/${link.id}`}
                      title={`${appUrl}/${link.slug}`}
                      className="font-mono text-label-14 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      /{link.slug}
                    </Link>
                    {link.title ? (
                      <p className="mt-0.5 truncate text-label-13 text-secondary">{link.title}</p>
                    ) : null}
                  </td>
                  <td className="max-w-xs truncate px-5 py-3.5 font-mono text-label-13 text-tertiary">
                    {link.destination_url}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge isActive={link.is_active} expiresAt={link.expires_at} now={now} />
                    {link.expires_at ? (
                      <p className="mt-1 text-xs text-[var(--ds-gray-900)]">
                        {formatDate(link.expires_at)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {linkTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded border border-[var(--ds-gray-400)] bg-[var(--ds-background-200)] px-1.5 py-0.5 text-[11px] text-[var(--ds-gray-900)]"
                        >
                          #{tag.name}
                        </span>
                      ))}
                      {linkFolders.map((folder) => (
                        <span
                          key={folder.id}
                          className="rounded border border-[var(--ds-gray-400)] bg-[var(--ds-background-200)] px-1.5 py-0.5 text-[11px] text-[var(--ds-gray-900)]"
                        >
                          {folderNameById.get(folder.id) ?? folder.name}
                        </span>
                      ))}
                      {linkTags.length === 0 && linkFolders.length === 0 ? (
                        <span className="text-label-12 text-tertiary">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums">{analytics.comparison.current}</td>
                  <td className="px-5 py-3.5 text-label-13 text-secondary">
                    {formatDate(link.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="space-y-3 border-t border-[var(--ds-gray-400)] pt-7">
        <h2 className="text-heading-16">Aggregate activity</h2>
        <AnalyticsPanel data={analytics} basePath="/dashboard" />
        <p className="text-label-12 text-tertiary">
          Counts are clicks, not unique visitors. Days are aggregated in UTC.
        </p>
      </section>
    </div>
  );
}