'use client';

import { useActionState, useState } from 'react';

import { saveBioPage, type BioPageResult } from '@/app/actions/bulk';

type Initial = {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  theme: string;
  accentColor: string;
  isPublished: boolean;
  siteUrl: string;
};

/**
 * Bio page editor.
 *
 * The live preview is the point: it shows exactly what a visitor will see,
 * including the rule that a link only appears once the owner has flagged it
 * on the link itself.
 */
export function BioPageForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState<BioPageResult | null, FormData>(
    saveBioPage,
    null
  );
  const [theme, setTheme] = useState(initial.theme);
  const [accent, setAccent] = useState(initial.accentColor);

  const bioUrl = initial.handle ? `${initial.siteUrl}/@${initial.handle}` : `${initial.siteUrl}/@handle`;

  return (
    <form action={action} className="card p-5">
      <h2 className="text-heading-16 text-primary">Link-in-bio page</h2>
      <p className="mt-1.5 text-copy-13 text-secondary">
        A public page at <code className="font-mono">/@handle</code> listing the links you choose.
        Only links you explicitly switch on appear.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="handle" className="block text-label-14 text-primary">
            Handle
          </label>
          <div className="flex items-center gap-2">
            <span className="font-mono text-label-14 text-tertiary">@</span>
            <input
              id="handle"
              name="handle"
              defaultValue={initial.handle}
              placeholder="yourname"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_\-]+"
              className="input font-mono"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="display_name" className="block text-label-14 text-primary">
            Display name
          </label>
          <input
            id="display_name"
            name="display_name"
            defaultValue={initial.displayName}
            required
            maxLength={64}
            className="input"
          />
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <label htmlFor="bio" className="block text-label-14 text-primary">
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          defaultValue={initial.bio}
          rows={3}
          maxLength={280}
          placeholder="One line about you or your work."
          className="input h-auto py-2"
        />
      </div>

      <div className="mt-4 space-y-1.5">
        <label htmlFor="avatar_url" className="block text-label-14 text-primary">
          Avatar URL <span className="font-normal text-tertiary">(optional)</span>
        </label>
        <input
          id="avatar_url"
          name="avatar_url"
          type="url"
          defaultValue={initial.avatarUrl}
          placeholder="https://…"
          className="input"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="theme" className="block text-label-14 text-primary">
            Layout
          </label>
          <select
            id="theme"
            name="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="input"
          >
            <option value="minimal">Minimal — single column</option>
            <option value="card">Card</option>
            <option value="grid">Grid — two columns</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="accent_color" className="block text-label-14 text-primary">
            Accent colour
          </label>
          <div className="flex items-center gap-2">
            <input
              id="accent_color"
              name="accent_color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              pattern="#[0-9a-fA-F]{6}"
              className="input font-mono"
            />
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#0070f3'}
              onChange={(e) => setAccent(e.target.value)}
              aria-label="Pick accent colour"
              className="h-9 w-12 cursor-pointer rounded-md border border-[var(--ds-gray-400)] bg-transparent"
            />
          </div>
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-label-14 text-primary">
        <input
          type="checkbox"
          name="is_published"
          defaultChecked={initial.isPublished}
          className="h-4 w-4 rounded border-[var(--ds-gray-400)]"
        />
        Publish this page
      </label>

      <div className="mt-5 flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        {state?.ok ? (
          <span role="status" className="text-label-13 text-[var(--ds-green-600)]">
            Saved
          </span>
        ) : null}
        {state && !state.ok ? (
          <span role="alert" className="text-label-13 text-[var(--ds-red-600)]">
            {state.error}
          </span>
        ) : null}
      </div>

      {state?.ok ? (
        <p className="mt-3 text-label-13 text-secondary">
          Live at{' '}
          <a href={bioUrl} className="link font-mono" target="_blank" rel="noopener noreferrer">
            {bioUrl}
          </a>
        </p>
      ) : null}

      {/* Preview */}
      <div className="mt-6 rounded-xl border border-[var(--ds-gray-400)] bg-[var(--ds-background-200)] p-5">
        <p className="mb-3 text-label-12 text-tertiary">Preview</p>
        <div className="mx-auto max-w-xs rounded-xl bg-[var(--ds-background-100)] p-5 text-center">
          <div
            aria-hidden
            className="mx-auto grid h-14 w-14 place-items-center rounded-full font-mono text-lg font-bold text-white"
            style={{ background: accent }}
          >
            {(initial.displayName || 'Y').slice(0, 1).toUpperCase()}
          </div>
          <p className="mt-3 text-label-14 text-primary">{initial.displayName || 'Your name'}</p>
          {initial.bio ? <p className="mt-1 text-label-12 text-tertiary">{initial.bio}</p> : null}
          <div
            className={`mt-4 ${theme === 'grid' ? 'grid gap-2' : 'space-y-2'} text-left`}
          >
            {['One', 'Two', 'Three'].map((n) => (
              <div
                key={n}
                className="rounded-lg border border-[var(--ds-gray-400)] px-3 py-2 text-label-12 text-secondary"
              >
                {n}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-label-12 text-tertiary">
          Placeholder only — the live page lists the links you have switched on.
        </p>
      </div>
    </form>
  );
}