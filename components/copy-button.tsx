'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * One-click copy with accessible success/error feedback.
 *
 * Uses the async clipboard API with a selection-based fallback for browsers
 * (or insecure contexts) where it is unavailable.
 */
export function CopyButton({
  value,
  label = 'Copy'
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function announce(next: 'copied' | 'error') {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        if (!ok) throw new Error('copy failed');
      }
      announce('copied');
    } catch {
      announce('error');
    }
  }

  const text = state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : label;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        aria-label={`${label}: ${value}`}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:border-[var(--accent)]"
      >
        {text}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? `${value} copied to clipboard` : ''}
      </span>
    </span>
  );
}