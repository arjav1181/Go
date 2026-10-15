/**
 * Effective destination resolution for the redirect engine.
 *
 * Precedence, highest first:
 *   1. an active scheduled window covering `now`;
 *   2. a weighted variant (A/B split or rotation);
 *   3. the link's own destination.
 *
 * All functions here are pure and take an injectable `now` / `random`, so the
 * rules are testable without a database or a clock.
 */

export type ScheduleWindow = {
  id: string;
  destination_url: string;
  starts_at: string;
  ends_at: string | null;
};

export type Variant = {
  id: string;
  label: string;
  destination_url: string;
  weight: number;
  is_active: boolean;
};

export type DestinationSource = 'schedule' | 'variant' | 'link';

export type ResolvedDestination = {
  destination: string;
  source: DestinationSource;
  label: string | null;
};

/** A schedule applies when it has started and not yet ended. */
export function isScheduleActive(schedule: ScheduleWindow, now: Date): boolean {
  const nowMs = now.getTime();
  const startMs = new Date(schedule.starts_at).getTime();
  if (!Number.isFinite(startMs) || nowMs < startMs) return false;
  if (schedule.ends_at === null) return true;
  const endMs = new Date(schedule.ends_at).getTime();
  if (!Number.isFinite(endMs)) return false;
  return nowMs < endMs;
}

/** Windows that overlap the proposed [starts_at, ends_at) window. */
export function findOverlappingSchedules(
  schedules: ScheduleWindow[],
  startsAt: string,
  endsAt: string | null,
  excludeId?: string
): ScheduleWindow[] {
  const startMs = new Date(startsAt).getTime();
  const endMs = endsAt === null ? Infinity : new Date(endsAt).getTime();

  return schedules.filter((schedule) => {
    if (schedule.id === excludeId) return false;
    const existingStart = new Date(schedule.starts_at).getTime();
    const existingEnd = schedule.ends_at === null ? Infinity : new Date(schedule.ends_at).getTime();
    // Half-open intervals overlap when each starts before the other ends.
    return startMs < existingEnd && existingStart < endMs;
  });
}

/**
 * The active window, preferring the most recently started one so nested
 * schedules resolve deterministically rather than by row order.
 */
export function selectActiveSchedule(
  schedules: ScheduleWindow[],
  now: Date
): ScheduleWindow | null {
  const active = schedules.filter((schedule) => isScheduleActive(schedule, now));
  if (active.length === 0) return null;
  return active.reduce((latest, current) =>
    new Date(current.starts_at).getTime() > new Date(latest.starts_at).getTime() ? current : latest
  );
}

export function activeVariants(variants: Variant[]): Variant[] {
  return variants.filter((variant) => variant.is_active && variant.weight > 0);
}

/**
 * Weighted random selection.
 *
 * `random` must return a value in [0, 1). Weights are treated as relative, so
 * [1, 3] splits 25/75 exactly as [25, 75] would.
 */
export function pickWeightedVariant(
  variants: Variant[],
  random: () => number = Math.random
): Variant | null {
  const candidates = activeVariants(variants);
  if (candidates.length === 0) return null;

  const total = candidates.reduce((sum, variant) => sum + variant.weight, 0);
  if (total <= 0) return null;

  const roll = random() * total;
  let cursor = 0;
  for (const variant of candidates) {
    cursor += variant.weight;
    if (roll < cursor) return variant;
  }
  // Floating-point safety net: fall back to the last candidate.
  return candidates[candidates.length - 1];
}

export function resolveEffectiveDestination(input: {
  linkDestination: string;
  schedules?: ScheduleWindow[];
  variants?: Variant[];
  now?: Date;
  random?: () => number;
}): ResolvedDestination {
  const now = input.now ?? new Date();

  const schedule = selectActiveSchedule(input.schedules ?? [], now);
  if (schedule) {
    return { destination: schedule.destination_url, source: 'schedule', label: null };
  }

  const variant = pickWeightedVariant(input.variants ?? [], input.random);
  if (variant) {
    return { destination: variant.destination_url, source: 'variant', label: variant.label };
  }

  return { destination: input.linkDestination, source: 'link', label: null };
}