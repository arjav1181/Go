'use client';

import { useState } from 'react';

export function RuleDeleteButton({
  action,
  label
}: {
  action: () => Promise<void>;
  label: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={() => setConfirming(true)}
        className="text-xs text-[var(--muted)] underline hover:text-red-600"
      >
        Remove
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            await action();
          } finally {
            setPending(false);
          }
        }}
        className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-60"
      >
        {pending ? '…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="text-xs text-[var(--muted)] underline"
      >
        Cancel
      </button>
    </span>
  );
}