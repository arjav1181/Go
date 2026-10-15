/**
 * Pure shortcut-matching logic, kept separate from the React component so it
 * can be unit tested without a DOM.
 */

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export type ShortcutEventLike = {
  key: string;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** Structural: a real KeyboardEvent or any plain stand-in used in tests. */
  target?: unknown;
};

/**
 * Decide whether a keydown should trigger the "create link" shortcut.
 *
 * Guards, in order:
 *  - an already-handled event is left alone;
 *  - modifier combinations are left to the browser (Cmd/Ctrl/Alt+N);
 *  - typing in an input, textarea, select or contenteditable is never hijacked;
 *  - only the unmodified `n` key triggers the action.
 */
export function shouldTriggerCreateShortcut(event: ShortcutEventLike): boolean {
  if (event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  const target = event.target;
  if (target && typeof target === 'object') {
    const element = target as { tagName?: unknown; isContentEditable?: unknown };
    if (element.isContentEditable === true) return false;
    if (typeof element.tagName === 'string' && EDITABLE_TAGS.has(element.tagName.toUpperCase())) {
      return false;
    }
  }

  return event.key === 'n' || event.key === 'N';
}