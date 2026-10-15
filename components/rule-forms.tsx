'use client';

import { useActionState } from 'react';

type State = { ok: boolean; message: string };

export function RuleForms({
  action,
  submitLabel,
  fields
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  submitLabel: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    placeholder?: string;
    required?: boolean;
    min?: string;
    max?: string;
    step?: string;
    hint?: string;
  }>;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: '' });

  return (
    <form action={formAction} className="space-y-3">
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1">
            <label htmlFor={field.name} className="text-sm font-medium">
              {field.label}
            </label>
            <input
              id={field.name}
              name={field.name}
              type={field.type}
              required={field.required ?? false}
              placeholder={field.placeholder}
              min={field.min}
              max={field.max}
              step={field.step}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            />
            {field.hint ? <p className="text-xs text-[var(--muted)]">{field.hint}</p> : null}
          </div>
        ))}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}