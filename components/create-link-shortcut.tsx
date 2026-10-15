'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { shouldTriggerCreateShortcut } from '@/lib/shortcuts/create-link';

/**
 * Keyboard shortcut for creating a link.
 *
 * `n` (without modifiers) navigates to the new-link form. It is suppressed
 * while the user is typing in a field or holding a modifier, so it can never
 * interrupt text entry or hijack browser shortcuts.
 */
export function CreateLinkShortcut() {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shouldTriggerCreateShortcut(event)) return;
      event.preventDefault();
      router.push('/links/new');
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return (
    <kbd className="rounded border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 font-mono text-[10px]">
      n
    </kbd>
  );
}