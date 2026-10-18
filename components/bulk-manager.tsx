'use client';

import { useActionState, useRef, useState } from 'react';

import {
  importLinks,
  exportLinksCsv,
  type BulkResult
} from '@/app/actions/bulk';
import { IMPORT_HEADERS } from '@/lib/links/bulk';

const SAMPLE = `${IMPORT_HEADERS.join(',')}
launch,https://example.com/blog/launch,Launch post,spring,
docs,https://example.com/docs,Documentation,,,docs|reference
signup,https://example.com/signup,Sign up,winter,Str0ngPass!,growth`;

export function BulkManager() {
  const [state, action, pending] = useActionState<BulkResult | null, FormData>(importLinks, null);
  const [dragging, setDragging] = useState(false);
  const [filename, setFilename] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function downloadExport() {
    const result = await exportLinksCsv();
    if (!result.ok) return;
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'go-links.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Import */}
      <div className="card p-5">
        <h2 className="text-heading-16 text-primary">Import links</h2>
        <p className="mt-1.5 text-copy-13 text-secondary">
          Upload a CSV. Rows are validated individually, so one bad row never blocks the rest.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file && inputRef.current) {
              const dt = new DataTransfer();
              dt.items.add(file);
              inputRef.current.files = dt.files;
              setFilename(file.name);
            }
          }}
          className={`mt-4 rounded-xl border border-dashed p-6 text-center transition-colors ${
            dragging
              ? 'border-[var(--ds-gray-1000)] bg-[var(--ds-background-200)]'
              : 'border-[var(--ds-gray-400)]'
          }`}
        >
          <input className="input input-file sr-only" ref={inputRef}
            id="import-file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(e) => setFilename(e.target.files?.[0]?.name ?? '')}
             />
          <label
            htmlFor="import-file"
            className="btn btn-secondary cursor-pointer"
          >
            Choose CSV
          </label>
          <p className="mt-2 text-label-13 text-tertiary">
            {filename || 'or drag a file here'}
          </p>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-label-13 text-secondary">
            Expected columns
          </summary>
          <p className="mt-2 font-mono text-label-12 text-tertiary">
            {IMPORT_HEADERS.join(', ')}
          </p>
          <p className="mt-2 text-label-12 text-tertiary">
            Only <code>slug</code> and <code>destination_url</code> are required. Separate multiple
            tags with <code>|</code>. Passwords are optional and must meet the policy.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--ds-background-200)] p-3 text-label-12">
            {SAMPLE}
          </pre>
        </details>

        <form action={action} className="mt-4">
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? 'Importing…' : 'Import'}
          </button>
        </form>

        {state ? (
          state.ok ? (
            <div
              role="status"
              className="mt-4 rounded-lg border border-[var(--ds-green-500)]/30 bg-[var(--ds-green-500)]/10 px-4 py-3"
            >
              <p className="text-label-14 text-[var(--ds-green-600)]">
                Created {state.created} of {state.total} rows.
              </p>
              {state.skipped.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-label-13 text-secondary">
                    {state.skipped.length} row{state.skipped.length === 1 ? '' : 's'} skipped
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-label-12 text-secondary">
                    {state.skipped.map((item, i) => (
                      <li key={i} className="font-mono">
                        {item.ok ? '' : item.line ? `line ${item.line}: ` : ''}
                        {item.ok ? '' : item.error}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-[var(--ds-red-500)]/30 bg-[var(--ds-red-500)]/10 px-4 py-3 text-copy-13 text-[var(--ds-red-600)]"
            >
              {state.error}
            </p>
          )
        ) : null}
      </div>

      {/* Export */}
      <div className="card p-5">
        <h2 className="text-heading-16 text-primary">Export links</h2>
        <p className="mt-1.5 text-copy-13 text-secondary">
          A CSV you can edit and import back. Passwords are never included — only whether a link is
          protected.
        </p>
        <button type="button" onClick={downloadExport} className="btn btn-secondary mt-4">
          Download CSV
        </button>
      </div>
    </div>
  );
}