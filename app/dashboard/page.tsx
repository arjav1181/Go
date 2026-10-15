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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--muted)]">Manage your short links and view aggregate clicks.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={exportHref({ range: resolved?.range, start: resolved?.start, end: resolved?.end }, 'granular')}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium"
          >
            Export CSV (detail)
          </a>
          <a
            href={exportHref({ range: resolved?.range, start: resolved?.start, end: resolved?.end }, 'daily')}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium"
          >
            Export CSV (daily)
          </a>
          <Link
            href="/links/new"
            className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            New link
            <kbd className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px]">n</kbd>
          </Link>
        </div>
      </div>

      <form method="get" action="/dashboard" className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={rawQuery}
          placeholder="Search by slug or title"
          aria-label="Search links by slug or title"
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
        {activeTag ? <input type="hidden" name="tag" value={activeTag.id} /> : null}
        <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
          Search
        </button>
      </form>

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">Filter by tag:</span>
          <Link
            href="/dashboard"
            aria-current={activeTag ? undefined : 'page'}
            className={
              activeTag
                ? 'rounded-full border border-[var(--border)] px-3 py-1 text-xs'
                : 'rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white'
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
                  ? 'rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-[var(--border)] px-3 py-1 text-xs'
              }
            >
              {tag.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--card)] text-left text-xs uppercase text-[var(--muted)]">
            <tr>
              <th scope="col" className="px-4 py-3">Slug / title</th>
              <th scope="col" className="px-4 py-3">Destination</th>
              <th scope="col" className="px-4 py-3">State</th>
              <th scope="col" className="px-4 py-3">Organisation</th>
              <th scope="col" className="px-4 py-3">Clicks</th>
              <th scope="col" className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted)]">
                  {rawQuery || activeTag
                    ? 'No links match this search or filter.'
                    : 'No links yet. Create your first short link.'}
                </td>
              </tr>
            ) : null}
            {visible.map((link) => {
              const rel = relations.get(link.id) ?? { tag_ids: [], folder_ids: [] };
              const linkTags = tags.filter((tag) => rel.tag_ids.includes(tag.id));
              const linkFolders = folders.filter((folder) => rel.folder_ids.includes(folder.id));
              return (
                <tr key={link.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-3">
                    <Link href={`/links/${link.id}`} className="font-medium text-[var(--accent)]">
                      {link.slug}
                    </Link>
                    {link.title ? (
                      <p className="text-xs text-[var(--muted)]">{link.title}</p>
                    ) : null}
                    <p className="text-xs text-[var(--muted)] font-mono">
                      {appUrl}/{link.slug}
                    </p>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-[var(--muted)]">
                    {link.destination_url}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge isActive={link.is_active} expiresAt={link.expires_at} now={now} />
                    {link.expires_at ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {formatDate(link.expires_at)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {linkTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full bg-[var(--card)] px-2 py-0.5 text-xs ring-1 ring-[var(--border)]"
                        >
                          #{tag.name}
                        </span>
                      ))}
                      {linkFolders.map((folder) => (
                        <span
                          key={folder.id}
                          className="rounded-full bg-[var(--card)] px-2 py-0.5 text-xs ring-1 ring-[var(--border)]"
                        >
                          {folderNameById.get(folder.id) ?? folder.name}
                        </span>
                      ))}
                      {linkTags.length === 0 && linkFolders.length === 0 ? (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">{analytics.comparison.current}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {formatDate(link.created_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Aggregate activity</h2>
        <AnalyticsPanel data={analytics} basePath="/dashboard" />
        <p className="text-xs text-[var(--muted)]">
          Counts are clicks, not unique visitors. Days are aggregated in UTC.
        </p>
      </section>
    </div>
  );
}