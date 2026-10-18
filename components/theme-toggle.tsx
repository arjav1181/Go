'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'go-theme';

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark' || v === 'system';

/** Resolve which of light/dark should actually render right now. */
function resolve(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  const dark = resolve(theme) === 'dark';
  root.classList.toggle('dark', dark);
  root.classList.toggle('dark-theme', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.theme = theme;
}

/**
 * Subscribe to the stored preference and to the OS setting.
 *
 * This is an external store rather than component state, so it is read with
 * useSyncExternalStore rather than mirrored into useState inside an effect.
 * Mirroring would mean a second render pass on every mount to pick up a value
 * that was already sitting in localStorage.
 */
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };

  media.addEventListener('change', onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    media.removeEventListener('change', onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): Theme {
  const stored = window.localStorage.getItem(KEY);
  return isTheme(stored) ? stored : 'system';
}

/** The server has no localStorage and no media query, so it cannot know. */
function getServerSnapshot(): Theme {
  return 'system';
}

/**
 * Theme switcher.
 *
 * The bootstrap script in the layout has already applied the right class before
 * first paint, so this control never has to fight the page it sits on top of.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const choose = useCallback((next: Theme) => {
    window.localStorage.setItem(KEY, next);
    apply(next);
    // Nothing else is listening on the same tab, so notify subscribers here.
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  }, []);

  /**
   * Keep the document in step when the OS setting changes while the preference
   * is 'system'. An explicit light/dark choice is left alone — that is the point
   * of choosing one.
   */
  useEffect(() => {
    if (theme !== 'system') return;
    apply('system');
  }, [theme]);

  const options: Array<{ value: Theme; label: string; glyph: string }> = [
    { value: 'light', label: 'Light', glyph: '☀' },
    { value: 'dark', label: 'Dark', glyph: '☾' },
    { value: 'system', label: 'System', glyph: '◐' }
  ];

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {options.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            className={`theme-toggle-option${active ? ' is-active' : ''}`}
            onClick={() => choose(o.value)}
          >
            <span aria-hidden>{o.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Runs before first paint from the document head.
 *
 * Must be inline and synchronous: anything deferred loses the race and a
 * dark-mode visitor gets a white flash on every navigation.
 */
export const themeBootstrapScript = `(function(){try{var t=localStorage.getItem('${KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.classList.toggle('dark-theme',d);r.style.colorScheme=d?'dark':'light';r.dataset.theme=t;}catch(e){}})();`;