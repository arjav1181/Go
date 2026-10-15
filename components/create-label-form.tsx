'use client';

import { useActionState } from 'react';
import { CopyButton } from '@/components/copy-button';

type State = { ok: boolean; message: string; newKey?: string };

export function CreateLabelForm({
  action,
  label,
  placeholder,
  exposeKey = false,
  withScopes = false
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  label: string;
  placeholder: string;
  /** Render a one-time secret (API key) after successful creation. */
  exposeKey?: boolean;
  /** Offer least-privilege scope selection for API keys. */
  withScopes?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: '' });

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      {withScopes ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Scopes</legend>
          <div className="flex flex-wrap gap-3">
            {(['links:read', 'links:write', 'analytics:read'] as const).map((scope) => (
              <label key={scope} className="inline-flex items-center gap-1 text-sm">
                <input type="checkbox" name="scopes" value={scope} defaultChecked={scope === 'links:read'} className="accent-[var(--accent)]" />
                {scope}
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--muted)]">Grant only what the caller needs.</p>
        </fieldset>
      ) : null}

      <div className="space-y-1">
        <label htmlFor={`new-${label}`} className="text-sm font-medium">
          New {label.toLowerCase()}
        </label>
        <input
          id={`new-${label}`}
          name="name"
          type="text"
          required
          placeholder={placeholder}
          className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Adding…' : `Add ${label.toLowerCase()}`}
      </button>
      {state.message ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={
            state.ok
              ? 'text-sm text-green-700 dark:text-green-400'
              : 'text-sm text-red-700 dark:text-red-400'
          }
        >
          {state.message}
        </p>
      ) : null}

      {exposeKey && state.ok && state.newKey ? (
        <div className="w-full space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Copy this key now. It is stored only as a hash and cannot be shown again.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-black/40">
              {state.newKey}
            </code>
            <CopyButton value={state.newKey} label="Copy key" />
          </div>
        </div>
      ) : null}
    </form>
  );
}