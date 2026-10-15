'use client';

import { useActionState, useState } from 'react';
import { COMMON_TIMEZONES } from '@/lib/schedules/timezone';

type State = { ok: boolean; message: string; issues?: string[] };

/**
 * Rule editor.
 *
 * The form is intentionally explicit about what is supported: a query
 * parameter condition and a time-window condition. There is no field for an
 * expression, a pattern or a script, because none are evaluated.
 */
export function RuleForm({
  action,
  submitLabel,
  initial,
  initialTimeZone = 'UTC'
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  submitLabel: string;
  /** Rendered as the default zone selector value; the owner can change it. */
  initialTimeZone?: string;
  initial?: {
    name?: string;
    priority?: number;
    destination_url?: string;
    weight?: number;
    is_active?: boolean;
    param?: string;
    param_values?: string;
    starts_at?: string;
    ends_at?: string;
  };
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: '' });

  // The zone is chosen here, submitted with the form, then converted to UTC
  // server-side so the stored instant is unambiguous.
  const [timeZone, setTimeZone] = useState<string>(initialTimeZone);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
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

      {state.issues && state.issues.length > 0 ? (
        <ul className="space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="rule-name" className="text-sm font-medium">Name</label>
          <input
            id="rule-name"
            name="name"
            type="text"
            required
            defaultValue={initial?.name ?? ''}
            placeholder="german-visitors"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rule-priority" className="text-sm font-medium">Priority</label>
          <input
            id="rule-priority"
            name="priority"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={initial?.priority ?? 1}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
          <p className="text-xs text-[var(--muted)]">Lower runs first.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="rule-weight" className="text-sm font-medium">Weight</label>
          <input
            id="rule-weight"
            name="weight"
            type="number"
            min={0}
            max={100}
            step={1}
            required
            defaultValue={initial?.weight ?? 100}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="rule-destination" className="text-sm font-medium">Destination URL</label>
        <input
          id="rule-destination"
          name="destination_url"
          type="url"
          required
          defaultValue={initial?.destination_url ?? ''}
          placeholder="https://example.com/de"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
        />
      </div>

      <fieldset className="space-y-2 border-t border-[var(--border)] pt-3">
        <legend className="text-sm font-medium">Condition: query parameter</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            name="param"
            type="text"
            placeholder="Parameter name (e.g. lang)"
            defaultValue={initial?.param ?? ''}
            aria-label="Query parameter name"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
          <input
            name="param_values"
            type="text"
            placeholder="Allowed values (comma separated)"
            defaultValue={initial?.param_values ?? ''}
            aria-label="Allowed parameter values"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          />
        </div>
        <p className="text-xs text-[var(--muted)]">
          Exact match only — no patterns or expressions. Known tracking parameters (utm_*, gclid,
          fbclid, …) are ignored unless you name them here.
        </p>
      </fieldset>

      <fieldset className="space-y-2 border-t border-[var(--border)] pt-3">
        <legend className="text-sm font-medium">Condition: time window</legend>
        <div className="space-y-1">
          <label htmlFor="rule-tz" className="text-xs font-medium text-[var(--muted)]">
            Time zone
          </label>
          <select
            id="rule-tz"
            name="time_zone"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm sm:w-64"
          >
            {COMMON_TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="rule-start" className="text-xs font-medium text-[var(--muted)]">Starts at</label>
            <input
              id="rule-start"
              name="starts_at"
              type="datetime-local"
              defaultValue={initial?.starts_at ?? ''}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="rule-end" className="text-xs font-medium text-[var(--muted)]">Ends at (optional)</label>
            <input
              id="rule-end"
              name="ends_at"
              type="datetime-local"
              defaultValue={initial?.ends_at ?? ''}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">Entered in {timeZone}; stored as UTC.</p>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="rule-active" className="text-sm font-medium">State</label>
        <select
          id="rule-active"
          name="is_active"
          defaultValue={initial?.is_active === false ? 'false' : 'true'}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm sm:w-48"
        >
          <option value="true">Active</option>
          <option value="false">Disabled</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}