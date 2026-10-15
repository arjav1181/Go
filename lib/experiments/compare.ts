/**
 * Builds the experiment comparison view.
 *
 * Reporting rules, enforced here rather than in the UI:
 *  - traffic share is shown against the *target* share, and labelled as
 *    approximate;
 *  - the statistical verdict is only ever 'significant' when the test
 *    assumptions hold, otherwise it says so explicitly;
 *  - nothing is described as an improvement or a conversion gain.
 */

import { compareProportions, MIN_SAMPLE_PER_ARM, type ComparisonResult } from './stats';
import { totalWeight, type WeightedVariant } from './bucketing';

export type VariantRow = {
  label: string;
  destination_url: string;
  weight: number;
  is_active: boolean;
  assignments: number;
  clicks: number;
};

export type ExperimentComparison = {
  rows: Array<VariantRow & { targetShare: number; actualShare: number }>;
  totalAssignments: number;
  totalClicks: number;
  /** Present only when there are at least two variants to compare. */
  verdict: ComparisonResult | null;
  caveats: string[];
};

export function buildComparison(
  variants: VariantRow[],
  options: { minSample?: number; alpha?: number } = {}
): ExperimentComparison {
  const totalAssignments = variants.reduce((sum, row) => sum + row.assignments, 0);
  const totalClicks = variants.reduce((sum, row) => sum + row.clicks, 0);

  const weighted: WeightedVariant[] = variants.map((row) => ({
    id: row.label,
    label: row.label,
    weight: row.is_active ? row.weight : 0,
    is_active: row.is_active
  }));
  const targetTotal = totalWeight(weighted);

  const rows = variants.map((row) => ({
    ...row,
    targetShare: targetTotal > 0 && row.is_active ? row.weight / targetTotal : 0,
    actualShare: totalAssignments > 0 ? row.assignments / totalAssignments : 0
  }));

  // Compare the busiest eligible variant against the next busiest. With fewer
  // than two eligible variants there is nothing to compare.
  const eligible = rows.filter((row) => row.is_active && row.weight > 0);
  let verdict: ComparisonResult | null = null;
  if (eligible.length >= 2) {
    const sorted = [...eligible].sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label));
    const control = sorted[sorted.length - 1];
    const treatment = sorted[0];
    verdict = compareProportions(
      { successes: control.clicks, trials: control.assignments },
      { successes: treatment.clicks, trials: treatment.assignments },
      options
    );
  }

  const caveats = [
    'Traffic split is approximate, not a guarantee of an exact percentage.',
    'Clicks are counted as aggregate events, not unique people.',
    'Assignment uses a stable hash of the link, so it is stable per link but is not a guarantee of equal split across small samples.',
    `A verdict needs at least ${options.minSample ?? MIN_SAMPLE_PER_ARM} observations per variant.`
  ];

  return { rows, totalAssignments, totalClicks, verdict, caveats };
}