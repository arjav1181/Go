import { authorizeApiRequest, apiError, apiJson } from '@/lib/api/auth';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { buildConfigSnapshot, simulateDistribution, replayAssignment, type ExperimentConfig } from '@/lib/experiments/replay';
import { buildComparison, type VariantRow } from '@/lib/experiments/compare';
import { experimentSalt } from '@/lib/links/resolve-target';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/v1/experiments/:id — reproducible experiment evaluation.
 *
 * Returns three things a reader can independently check:
 *  1. the archived configuration, versioned and fingerprinted;
 *  2. aggregate counts with sample sizes and explicit limitations;
 *  3. a simulated routing-distribution check plus a single deterministic replay.
 *
 * The simulation is a property of the bucketing function, NOT evidence about real
 * visitors. The doc makes that distinction explicit.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'analytics:read');
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) return apiError('not_found', 'Experiment not found.');

  const url = new URL(request.url);
  const versionParam = Number(url.searchParams.get('version') ?? '0');
  try {
    const supabase = getServiceSupabase();

    const { data: experiment } = await supabase
      .from('link_experiments')
      .select('id, link_id, name, status, hypothesis, outcome_metric, starts_at, ends_at, created_at, stopped_at')
      .eq('id', id)
      .single();

    if (!experiment) return apiError('not_found', 'Experiment not found.');

    // Ownership: the experiment's link must belong to this key's owner.
    const { data: link } = await supabase
      .from('links')
      .select('id, slug, created_by, domain')
      .eq('id', experiment.link_id)
      .eq('created_by', auth.ownerId)
      .maybeSingle();

    if (!link) return apiError('not_found', 'Experiment not found.');

    const { data: variants } = await supabase
      .from('link_variants')
      .select('id, label, destination_url, weight, is_active')
      .eq('experiment_id', id)
      .order('label', { ascending: true });

    const variantRows = (variants ?? []) as Array<{
      id: string;
      label: string;
      destination_url: string;
      weight: number;
      is_active: boolean;
    }>;

    // Archived snapshot, falling back to the live configuration for version 0.
    const { data: versions } = await supabase
      .from('experiment_config_versions')
      .select('version, config, created_at')
      .eq('experiment_id', id)
      .order('version', { ascending: false });

    const archived = (versions ?? []) as Array<{ version: number; config: unknown; created_at: string }>;
    const selected =
      Number.isFinite(versionParam) && versionParam > 0
        ? archived.find((entry) => entry.version === versionParam)
        : archived[0];

    const config: ExperimentConfig = selected
      ? (selected.config as ExperimentConfig)
      : buildConfigSnapshot({
          linkId: experiment.link_id,
          domain: link.domain ?? '',
          salt: experimentSalt(),
          variants: variantRows,
          outcomeMetric: experiment.outcome_metric ?? 'clicks',
          version: 0
        });

    const { data: outcomes } = await supabase
      .from('experiment_outcomes')
      .select('variant_label, assignments, clicks')
      .eq('experiment_id', id);

    const outcomeByLabel = new Map<string, { assignments: number; clicks: number }>();
    for (const row of (outcomes ?? []) as Array<{
      variant_label: string;
      assignments: number | string;
      clicks: number | string;
    }>) {
      outcomeByLabel.set(row.variant_label, {
        assignments: Number(row.assignments),
        clicks: Number(row.clicks)
      });
    }

    const comparison = buildComparison(
      variantRows.map<VariantRow>((variant) => ({
        label: variant.label,
        destination_url: variant.destination_url,
        weight: variant.weight,
        is_active: variant.is_active,
        assignments: outcomeByLabel.get(variant.label)?.assignments ?? 0,
        clicks: outcomeByLabel.get(variant.label)?.clicks ?? 0
      }))
    );

    const simulation = simulateDistribution(config, 20_000);
    const replay = replayAssignment(config);

    return apiJson({
      experiment: {
        id: experiment.id,
        name: experiment.name,
        status: experiment.status,
        hypothesis: experiment.hypothesis ?? null,
        outcome_metric: experiment.outcome_metric ?? 'clicks',
        window: {
          starts_at: experiment.starts_at ?? null,
          ends_at: experiment.ends_at ?? null
        },
        created_at: experiment.created_at,
        stopped_at: experiment.stopped_at ?? null
      },
      configuration: {
        version: config.version,
        captured_at: config.captured_at,
        salt_fingerprint: config.salt ? '[salt configured]' : '[no salt]',
        variants: config.variants
      },
      results: {
        total_assignments: comparison.totalAssignments,
        total_clicks: comparison.totalClicks,
        variants: comparison.rows,
        verdict: comparison.verdict
      },
      routing_check: {
        note: 'This checks the bucketing function against the configured weights. It is NOT a measurement of real visitors and says nothing about conversion.',
        trials: simulation.trials,
        target_share: simulation.targetShare,
        observed_share: simulation.observedShare,
        max_deviation_points: Math.round(simulation.maxDeviationPoints * 100) / 100,
        within_tolerance: simulation.withinTolerance
      },
      replay: {
        note: 'Deterministic: the same configuration and salt always yield this result.',
        bucket: replay.bucket,
        variant: replay.variant?.label ?? null,
        explanation: replay.explanation
      },
      limitations: [
        ...comparison.caveats,
        'Clicks are counted as aggregate events, not unique people, so observations are not independent when one person clicks repeatedly.',
        'With more than two variants, pairwise testing raises the chance of a false positive; no correction is applied.',
        'Traffic split is approximate; small samples will not match target weights exactly.'
      ]
    });
  } catch {
    return apiError('server_error', 'Unable to load experiment.');
  }
}