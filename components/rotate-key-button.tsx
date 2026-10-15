'use client';

import { useActionState } from 'react';
import { CopyButton } from '@/components/copy-button';

type State = { ok: boolean; message: string; newKey?: string };

/**
 * Rotate an API key.
 *
 * The replacement secret is returned once by the action, so it is rendered here
 * with a copy affordance. Losing it would mean rotating again.
 */
export function RotateKeyButton({
  action,
  name
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: '' });

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-[var(--border)] px-2 py-0.5 text-xs disabled:opacity-60"
        >
          {pending ? 'Rotating…' : 'Rotate'}
        </button>
      </form>

      {state.message ? (
        <span role="status" className="max-w-xs text-right text-xs text-[var(--muted)]">
          {state.message}
        </span>
      ) : null}

      {state.ok && state.newKey ? (
        <div className="max-w-xs space-y-1 rounded border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/40">
          <p className="text-xs text-amber-900 dark:text-amber-200">
            New key for &ldquo;{name}&rdquo; — copy it now.
          </p>
          <code className="block break-all font-mono text-[10px]">{state.newKey}</code>
          <CopyButton value={state.newKey} label="Copy key" />
        </div>
      ) : null}
    </div>
  );
}