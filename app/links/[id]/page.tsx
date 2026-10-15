import { requireOwner } from '@/lib/auth/owner';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { updateLink, toggleLink, deleteLink } from '@/app/actions/links';
import LinkForm from '@/components/link-form';
import { QrPanel } from '@/components/qr-panel';
import { DeleteLinkButton } from '@/components/delete-link-button';
import { AnalyticsPanel } from '@/components/analytics-panel';
import { StatusBadge } from '@/components/status-badge';
import { CopyButton } from '@/components/copy-button';
import { formatDate } from '@/lib/utils';
import { buildAnalytics } from '@/lib/analytics/queries';
import { listTags, listFolders, getRelationsForLinks } from '@/lib/tags/repo';
import {
  createScheduleAction,
  createVariantAction,
  deleteScheduleAction,
  deleteVariantAction,
  toggleVariantAction
} from '@/app/actions/rules';
import { RuleForms } from '@/components/rule-forms';
import { RuleForm } from '@/components/rule-form';
import { createRuleAction, deleteRuleAction, toggleRuleAction } from '@/app/actions/rules-config';
import { createExperimentAction } from '@/app/actions/experiments';
import { validateRuleSet } from '@/lib/rules/validate';
import { loadRules } from '@/lib/rules/repo';
import { ExperimentRow } from '@/components/experiment-row';
import { RulePreview } from '@/components/rule-preview';
import { RuleDeleteButton } from '@/components/rule-delete-button';
import { isScheduleActive, type ScheduleWindow } from '@/lib/links/target';
import type { ExperimentVariant } from '@/lib/links/resolve-target';
import { formatRemaining, msUntil } from '@/lib/links/status';
import Link from 'next/link';

export const metadata = {
  title: 'Link',
  // Private: owner-only page. Never indexed, never followed.
  robots: { index: false, follow: false, nocache: true }
};


type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; start?: string; end?: string }>;
};

export default async function LinkDetailPage({ params, searchParams }: PageProps) {
  const owner = await requireOwner();
  const { id } = await params;
  const query = await searchParams;

  const supabase = getServiceSupabase();
  const { data: link } = await supabase
    .from('links')
    .select('id, slug, destination_url, title, notes, is_active, expires_at, created_at')
    .eq('id', id)
    .single();

  if (!link) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Link not found</h1>
        <Link href="/dashboard" className="text-[var(--accent)]">Back to dashboard</Link>
      </div>
    );
  }

  const [analytics, tags, folders, relations] = await Promise.all([
    buildAnalytics({ linkIds: [id], preset: query.range, start: query.start, end: query.end }),
    listTags(owner.id),
    listFolders(owner.id),
    getRelationsForLinks([id])
  ]);

  const [{ data: scheduleRows }, { data: variantRows }, { data: experimentRows }] = await Promise.all([
    supabase
      .from('link_schedules')
      .select('id, destination_url, starts_at, ends_at')
      .eq('link_id', id)
      .order('starts_at', { ascending: true }),
    supabase
      .from('link_variants')
      .select('id, label, destination_url, weight, is_active, experiment_id')
      .eq('link_id', id)
      .order('label', { ascending: true }),
    supabase
      .from('link_experiments')
      .select('id, name, status')
      .eq('link_id', id)
      .order('created_at', { ascending: false })
  ]);

  const schedules = (scheduleRows ?? []) as ScheduleWindow[];
  const variants = (variantRows ?? []) as ExperimentVariant[];
  const now = new Date();
  const experiments = (experimentRows ?? []) as Array<{ id: string; name: string; status: string }>;

  // Per-variant assignment counts and click totals for the comparison view.
  const experimentStats: Record<
    string,
    Array<{ variant_label: string; assignment_count: number | string; clicks: number }>
  > = {};
  if (experiments.length > 0) {
    const { data: assignmentRows } = await supabase
      .from('experiment_daily_stats')
      .select('experiment_id, variant_label, assignment_count')
      .in('experiment_id', experiments.map((experiment) => experiment.id));

    const { data: clickRows } = await supabase
      .from('daily_click_stats')
      .select('variant_label, click_count')
      .eq('link_id', id)
      .neq('variant_label', '');

    const clickByLabel = new Map<string, number>();
    for (const row of clickRows ?? []) {
      clickByLabel.set(
        row.variant_label,
        (clickByLabel.get(row.variant_label) ?? 0) + Number(row.click_count)
      );
    }

    for (const experiment of experiments) {
      const labels = new Set<string>();
      for (const row of assignmentRows ?? []) {
        if (row.experiment_id === experiment.id) labels.add(row.variant_label);
      }
      for (const label of clickByLabel.keys()) labels.add(label);

      experimentStats[experiment.id] = [...labels].map((label) => ({
        variant_label: label,
        assignment_count: (assignmentRows ?? [])
          .filter((row) => row.experiment_id === experiment.id && row.variant_label === label)
          .reduce((sum, row) => sum + Number(row.assignment_count), 0),
        clicks: clickByLabel.get(label) ?? 0
      }));
    }
  }
  const rules = await loadRules(id);
  const ruleIssues = validateRuleSet(rules);

  const totalVariantWeight = variants
    .filter((v) => v.is_active)
    .reduce((sum, v) => sum + v.weight, 0);

  const linkRelations = relations.get(id) ?? { tag_ids: [], folder_ids: [] };
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const shortUrl = `${appUrl}/${link.slug}`;
  const updateAction = updateLink.bind(null, id);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{link.title || link.slug}</h1>
          <p className="font-mono text-sm text-[var(--muted)]">{shortUrl}</p>
          <p className="truncate text-sm text-[var(--muted)]">
            → <span className="font-mono">{link.destination_url}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge isActive={link.is_active} expiresAt={link.expires_at} />
          <CopyButton value={shortUrl} label="Copy" />
          <form action={toggleLink.bind(null, id, !link.is_active)}>
            <button
              type="submit"
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium"
            >
              {link.is_active ? 'Pause' : 'Activate'}
            </button>
          </form>
          <DeleteLinkButton action={deleteLink.bind(null, id)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted)]">Total clicks (selected range)</p>
          <p className="mt-1 text-2xl font-semibold">{analytics.comparison.current}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted)]">Expiry</p>
          <p className="mt-1 text-sm">
            {link.expires_at ? formatDate(link.expires_at) : 'No expiry'}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted)]">Created</p>
          <p className="mt-1 text-sm">{formatDate(link.created_at)}</p>
        </div>
      </div>

      <QrPanel linkId={id} shortUrl={shortUrl} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Analytics</h2>
        <AnalyticsPanel data={analytics} basePath={`/links/${id}`} linkId={id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Scheduled destinations</h2>
        <p className="text-sm text-[var(--muted)]">
          During a scheduled window this link points somewhere else. The active window wins over both
          variants and the default destination. Windows cannot overlap.
        </p>

        {schedules.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No scheduled windows.</p>
        ) : (
          <ul className="space-y-2">
            {schedules.map((schedule) => {
              const active = isScheduleActive(schedule, now);
              return (
                <li
                  key={schedule.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">
                      {schedule.destination_url}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {formatDate(schedule.starts_at)} →{' '}
                      {schedule.ends_at ? formatDate(schedule.ends_at) : 'no end'}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {active ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                        Active now
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">
                        {new Date(schedule.starts_at) > now
                          ? `starts in ${formatRemaining(msUntil(schedule.starts_at, now))}`
                          : 'ended'}
                      </span>
                    )}
                    <RuleDeleteButton
                      label="Remove scheduled window"
                      action={deleteScheduleAction.bind(null, id, schedule.id)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <RuleForms
          action={createScheduleAction.bind(null, id)}
          submitLabel="Add schedule"
          fields={[
            {
              name: 'destination_url',
              label: 'Destination URL',
              type: 'url',
              placeholder: 'https://example.com/promo',
              required: true
            },
            {
              name: 'starts_at',
              label: 'Starts at (UTC)',
              type: 'datetime-local',
              required: true,
              hint: 'Interpreted as UTC.'
            },
            {
              name: 'ends_at',
              label: 'Ends at (UTC, optional)',
              type: 'datetime-local',
              hint: 'Leave empty for an open-ended window.'
            }
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Weighted variants (A/B &amp; rotation)</h2>
        <p className="text-sm text-[var(--muted)]">
          When at least one variant is active, each visit is assigned one at random, weighted. Equal
          weights rotate evenly; a 25/75 split runs an A/B test. No visitor identity is stored — the
          choice is random per request.
        </p>

        {variants.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No variants. This link always uses its own destination.
          </p>
        ) : (
          <ul className="space-y-2">
            {variants.map((variant) => {
              const share =
                totalVariantWeight > 0 && variant.is_active && variant.weight > 0
                  ? Math.round((variant.weight / totalVariantWeight) * 100)
                  : 0;
              return (
                <li
                  key={variant.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{variant.label}</span>
                    <span className="block truncate font-mono text-xs text-[var(--muted)]">
                      {variant.destination_url}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-[var(--muted)]">
                      {variant.is_active && variant.weight > 0 ? `${share}% traffic` : 'no traffic'}
                    </span>
                    <form action={toggleVariantAction.bind(null, id, variant.id, !variant.is_active)}>
                      <button
                        type="submit"
                        className="rounded border border-[var(--border)] px-2 py-0.5 text-xs"
                      >
                        {variant.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </form>
                    <RuleDeleteButton
                      label={`Remove variant ${variant.label}`}
                      action={deleteVariantAction.bind(null, id, variant.id)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <RuleForms
          action={createVariantAction.bind(null, id)}
          submitLabel="Add variant"
          fields={[
            {
              name: 'label',
              label: 'Label',
              type: 'text',
              placeholder: 'a',
              required: true,
              hint: 'Lowercase letters, numbers, hyphens.'
            },
            {
              name: 'destination_url',
              label: 'Destination URL',
              type: 'url',
              placeholder: 'https://example.com/variant-a',
              required: true
            },
            {
              name: 'weight',
              label: 'Weight (0–100)',
              type: 'number',
              placeholder: '50',
              min: '0',
              max: '100',
              step: '1',
              hint: 'Relative: 1/3 behaves like 25/75.'
            }
          ]}
        />
      </section>


      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Conditional rules</h2>
        <p className="text-sm text-[var(--muted)]">
          Rules are evaluated in priority order; the first match wins. Only query-parameter equality
          and time windows are supported &mdash; there is no expression, pattern or script engine, and
          no IP, geo or user-agent conditions.
        </p>

        {ruleIssues.length > 0 ? (
          <ul className="space-y-1 rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {ruleIssues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <strong>{issue.ruleName}</strong> ({issue.severity}): {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        {rules.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No rules. Requests use the link&rsquo;s own destination.
          </p>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {rule.priority}. {rule.name}
                  </span>
                  <span className="block truncate font-mono text-xs text-[var(--muted)]">
                    {rule.destination_url}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {rule.conditions.length === 0
                      ? 'No conditions (disabled until configured)'
                      : rule.conditions
                          .map((c) =>
                            c.kind === 'query_param'
                              ? `${c.param} in [${c.value}]`
                              : `${formatDate(c.starts_at)} → ${c.ends_at ? formatDate(c.ends_at) : 'open'}`
                          )
                          .join(' AND ')}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <form action={toggleRuleAction.bind(null, id, rule.id, !rule.is_active)}>
                    <button type="submit" className="rounded border border-[var(--border)] px-2 py-0.5 text-xs">
                      {rule.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </form>
                  <RuleDeleteButton label={`Delete rule ${rule.name}`} action={deleteRuleAction.bind(null, id, rule.id)} />
                </span>
              </li>
            ))}
          </ul>
        )}

        <RuleForm action={createRuleAction.bind(null, id)} submitLabel="Add rule" initialTimeZone="UTC" />

        <RulePreview linkId={id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Experiments</h2>
        <p className="text-sm text-[var(--muted)]">
          Traffic is split by a stable hash of the link, so a visitor usually keeps the same variant
          between visits. Nothing about the visitor is stored and no cookie is set.
        </p>

        {experiments.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No experiments configured.</p>
        ) : (
          <ul className="space-y-2">
            {experiments.map((experiment) => (
              <ExperimentRow
                key={experiment.id}
                linkId={id}
                experiment={experiment}
                variants={variants.filter((v) => v.experiment_id === experiment.id)}
                stats={experimentStats[experiment.id] ?? []}
              />
            ))}
          </ul>
        )}

        <RuleForms
          action={createExperimentAction.bind(null, id)}
          submitLabel="Start experiment"
          fields={[
            { name: 'name', label: 'Experiment name', type: 'text', placeholder: 'homepage test', required: true },
            {
              name: 'hypothesis',
              label: 'Hypothesis (recorded, not enforced)',
              type: 'text',
              placeholder: 'Short description headline improves clicks',
              hint: 'Stored with the experiment so results can be read later.'
            },
            {
              name: 'starts_at',
              label: 'Window starts (UTC)',
              type: 'datetime-local',
              hint: 'Optional; evaluation period only.'
            },
            {
              name: 'ends_at',
              label: 'Window ends (UTC)',
              type: 'datetime-local'
            },
            { name: 'variant_label', label: 'Variant label', type: 'text', placeholder: 'a', required: true },
            { name: 'variant_destination', label: 'Destination', type: 'url', placeholder: 'https://example.com/a', required: true },
            { name: 'variant_weight', label: 'Weight', type: 'number', placeholder: '50', min: '0', max: '100', step: '1' },
            { name: 'variant_label_2', label: 'Variant label (2nd)', type: 'text', placeholder: 'b' },
            { name: 'variant_destination_2', label: 'Destination (2nd)', type: 'url', placeholder: 'https://example.com/b' },
            { name: 'variant_weight_2', label: 'Weight (2nd)', type: 'number', placeholder: '50', min: '0', max: '100', step: '1' }
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Edit</h2>
        <LinkForm
          action={updateAction}
          initialValues={{
            destination_url: link.destination_url,
            slug: link.slug,
            title: link.title,
            notes: link.notes,
            expires_at: link.expires_at,
            is_active: link.is_active,
            tag_ids: linkRelations.tag_ids,
            folder_ids: linkRelations.folder_ids
          }}
          submitLabel="Save changes"
          availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
          availableFolders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
        />
      </section>
    </div>
  );
}