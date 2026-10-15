'use client';

import { useState } from 'react';

export function DeleteLinkButton({ action }: { action: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700"
      >
        Delete
      </button>
    );
  }

  return (
    <form
      action={async () => {
        setPending(true);
        try {
          await action();
        } finally {
          setPending(false);
        }
      }}
      className="flex items-center gap-2"
    >
      <span className="text-sm text-red-700">Delete permanently?</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Deleting…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
      >
        Cancel
      </button>
    </form>
  );
}
