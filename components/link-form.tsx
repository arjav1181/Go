'use client';

import { useActionState, useState } from 'react';
import { LabelPicker } from '@/components/label-picker';

type FormState = { ok: boolean; message: string };

type Option = { id: string; name: string };

export default function LinkForm({
  action,
  initialValues,
  submitLabel,
  availableTags = [],
  availableFolders = []
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues?: {
    destination_url?: string | null;
    slug?: string;
    title?: string | null;
    notes?: string | null;
    expires_at?: string | null;
    is_active?: boolean;
    tag_ids?: string[];
    folder_ids?: string[];
  };
  submitLabel: string;
  availableTags?: Option[];
  availableFolders?: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: '' });
  const [slug, setSlug] = useState(initialValues?.slug ?? '');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const previewSlug = slug.trim() === '' ? '…' : slug.trim().toLowerCase();

  return (
    <form action={formAction} className="space-y-5">
      {state.message ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={
            state.ok
              ? 'rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300'
              : 'rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300'
          }
        >
          {state.message}
        </p>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="destination_url" className="text-sm font-medium">Destination URL</label>
        <input
          id="destination_url"
          name="destination_url"
          type="url"
          required
          defaultValue={initialValues?.destination_url ?? ''}
          placeholder="https://example.com/long/path"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="slug" className="text-sm font-medium">
          {initialValues ? 'Slug' : 'Custom slug (optional)'}
        </label>
        {initialValues ? (
          <>
            <input
              id="slug"
              type="text"
              value={slug}
              readOnly
              disabled
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm opacity-70"
            />
            <p className="text-xs text-[var(--muted)]">
              The slug cannot be changed after creation.
            </p>
          </>
        ) : (
          <>
            <input
              id="slug"
              name="slug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="leave blank to generate"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
            />
            <p className="text-xs text-[var(--muted)]">
              Preview: <span className="font-mono">{appUrl.replace(/\/$/, '')}/{previewSlug}</span>
            </p>
          </>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="title" className="text-sm font-medium">Title (optional)</label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={200}
          defaultValue={initialValues?.title ?? ''}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="notes" className="text-sm font-medium">Private note (optional)</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={initialValues?.notes ?? ''}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="expires_at" className="text-sm font-medium">Expires at (optional)</label>
        <input
          id="expires_at"
          name="expires_at"
          type="datetime-local"
          defaultValue={initialValues?.expires_at ? initialValues.expires_at.slice(0, 16) : ''}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        />
      </div>

      <LabelPicker
        legend="Tags"
        options={availableTags}
        name="tag_ids"
        newFieldName="new_tags"
        newFieldLabel="Add tags (comma separated)"
        newFieldPlaceholder="work, 2026"
        defaultSelected={initialValues?.tag_ids ?? []}
      />

      <LabelPicker
        legend="Folders"
        options={availableFolders}
        name="folder_ids"
        newFieldName="new_folders"
        newFieldLabel="Add folders (comma separated)"
        newFieldPlaceholder="projects"
        defaultSelected={initialValues?.folder_ids ?? []}
      />

      {initialValues ? (
        <div className="space-y-1">
          <label htmlFor="is_active" className="text-sm font-medium">State</label>
          <select
            id="is_active"
            name="is_active"
            defaultValue={initialValues.is_active ? 'true' : 'false'}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
          >
            <option value="true">Active</option>
            <option value="false">Paused</option>
          </select>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
