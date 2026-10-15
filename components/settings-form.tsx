'use client';

import { useActionState } from 'react';
import {
  MIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS
} from '@/lib/retention/retention';

type State = { ok: boolean; message: string };

export function SettingsForm({
  action,
  retention,
  aggregation
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  retention: { enabled: boolean; days: number };
  aggregation: { track_referrer: boolean; track_device: boolean };
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: '' });

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      {state.message ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={
            state.ok
              ? 'rounded-md bg-green-50 p-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300'
              : 'rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300'
          }
        >
          {state.message}
        </p>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Click history retention</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="retention_enabled"
            defaultChecked={retention.enabled}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Automatically delete click history older than the window below.
            <span className="block text-xs text-[var(--muted)]">
              Off by default. Deletion is permanent and runs once a day.
            </span>
          </span>
        </label>
        <div className="space-y-1">
          <label htmlFor="retention_days" className="text-sm font-medium">
            Keep this many days
          </label>
          <input
            id="retention_days"
            name="retention_days"
            type="number"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            step={1}
            defaultValue={retention.days || DEFAULT_RETENTION_DAYS}
            className="w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
          <p className="text-xs text-[var(--muted)]">
            Between {MIN_RETENTION_DAYS} and {MAX_RETENTION_DAYS} days.
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Aggregation dimensions</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="track_referrer"
            defaultChecked={aggregation.track_referrer}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Store referrer hostname
            <span className="block text-xs text-[var(--muted)]">Host only, never the full URL.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="track_device"
            defaultChecked={aggregation.track_device}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Store coarse device category
            <span className="block text-xs text-[var(--muted)]">
              Derived in memory from the User-Agent; the raw string is never stored.
            </span>
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}