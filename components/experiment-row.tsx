import { setExperimentStatusAction, deleteExperimentAction } from '@/app/actions/experiments';
import { RuleDeleteButton } from '@/components/rule-delete-button';
import { buildComparison, type VariantRow } from '@/lib/experiments/compare';
import type { ExperimentVariant } from '@/lib/links/resolve-target';

type Experiment = { id: string; name: string; status: string };

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  stopped: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Running',
  paused: 'Paused',
  stopped: 'Stopped'
};

/**
 * Experiment summary with an honest comparison readout.
 *
 * The verdict is only rendered when the statistical assumptions hold; otherwise
 * the component shows the test's own explanation of why it declined.
 */
export function ExperimentRow({
  linkId,
  experiment,
  variants,
  stats
}: {
  linkId: string;
  experiment: Experiment;
  variants: ExperimentVariant[];
  stats: Array<{ variant_label: string; assignment_count: number | string }>;
}) {
  const assignmentByLabel = new Map<string, number>();
  for (const row of stats) {
    assignmentByLabel.set(
      row.variant_label,
      (assignmentByLabel.get(row.variant_label) ?? 0) + Number(row.assignment_count)
    );
  }

  const rows: VariantRow[] = variants.map((variant) => ({
    label: variant.label,
    destination_url: variant.destination_url,
    weight: variant.weight,
    is_active: variant.is_active,
    assignments: assignmentByLabel.get(variant.label) ?? 0,
    // Clicks are grouped by variant label in the existing click stats; the
    // comparison treats assignments as the denominator and clicks as outcomes.
    clicks: variant.clicks ?? 0
  }));

  const comparison = buildComparison(rows);

  return (
    <li className="space-y-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{experiment.name}</span>
        <span className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[experiment.status] ?? ''}`}
          >
            {STATUS_LABEL[experiment.status] ?? experiment.status}
          </span>
          {experiment.status !== 'stopped' ? (
            <form action={setExperimentStatusAction.bind(null, linkId, experiment.id, experiment.status === 'active' ? 'paused' : 'active')}>
              <button type="submit" className="rounded border border-[var(--border)] px-2 py-0.5 text-xs">
                {experiment.status === 'active' ? 'Pause' : 'Resume'}
              </button>
            </form>
          ) : null}
          <RuleDeleteButton
            label={`Delete experiment ${experiment.name}`}
            action={deleteExperimentAction.bind(null, linkId, experiment.id)}
          />
        </span>
      </div>

      {variants.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          This experiment has no variants, so the link&rsquo;s own destination is served.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[var(--muted)]">
              <tr>
                <th scope="col" className="py-1 pr-3">Variant</th>
                <th scope="col" className="py-1 pr-3">Target</th>
                <th scope="col" className="py-1 pr-3">Actual</th>
                <th scope="col" className="py-1 pr-3">Assignments</th>
                <th scope="col" className="py-1 pr-3">Clicks</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.label} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-3">{row.label}</td>
                  <td className="py-1 pr-3">{(row.targetShare * 100).toFixed(1)}%</td>
                  <td className="py-1 pr-3">{(row.actualShare * 100).toFixed(1)}%</td>
                  <td className="py-1 pr-3">{row.assignments}</td>
                  <td className="py-1 pr-3">{row.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {comparison.verdict ? (
        <p
          className={
            comparison.verdict.status === 'significant'
              ? 'text-xs text-[var(--fg)]'
              : 'text-xs text-[var(--muted)]'
          }
        >
          {comparison.verdict.explanation}
        </p>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          Add a second variant to compare performance.
        </p>
      )}

      <ul className="list-disc pl-4 text-xs text-[var(--muted)]">
        {comparison.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>
    </li>
  );
}