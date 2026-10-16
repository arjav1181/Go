'use client';

import { useMemo, useState, useTransition } from 'react';
import { QrDesigner } from '@/components/qr-designer';
import {
  defaultCustomizations,
  type QrCustomizations
} from '@/lib/qr/customizations';

import type { StudioCode, StudioLink } from '@/lib/qr/listing';

export type { StudioCode, StudioLink };

/**
 * QR code management.
 *
 * The designer component existed with no entry point, so the feature was
 * reachable only through the API. This is the screen that makes it usable.
 */
export function QrStudio({ links, codes }: { links: StudioLink[]; codes: StudioCode[] }) {
  const [kind, setKind] = useState<'dynamic' | 'static'>('dynamic');
  const [target, setTarget] = useState<string>(links[0]?.id ?? 'url');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [design, setDesign] = useState<QrCustomizations>(defaultCustomizations);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * What will actually be encoded. Shown next to the preview so the owner can
   * confirm the code points where they think it does — a wrong preview target
   * is the most expensive mistake available in this screen.
   */
  const preview = useMemo(() => {
    if (kind === 'static') return content || 'https://example.com';
    if (target === 'url') return url || 'https://example.com';
    const link = links.find((l) => l.id === target);
    return link ? `/${link.slug}` : 'https://example.com';
  }, [kind, target, url, content, links]);

  function create() {
    setError(null);
    startTransition(async () => {
      const body: Record<string, unknown> = {
        title,
        kind,
        render_customizations: design
      };
      if (kind === 'static') body.content = content;
      else if (target === 'url') body.destination_url = url;
      else body.link_id = target;

      const res = await fetch('/api/v1/qr-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'Could not create the QR code.');
        return;
      }
      window.location.reload();
    });
  }

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <section className="card card-pad" style={{ display: 'grid', gap: '1rem' }}>
        <div className="section-head">
          <div>
            <h2 className="section-title">Create a code</h2>
            <p className="section-sub">Managed codes stay editable after you print them.</p>
          </div>
        </div>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'dynamic'}
            className={`tab${kind === 'dynamic' ? ' is-active' : ''}`}
            onClick={() => setKind('dynamic')}
          >
            Managed
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === 'static'}
            className={`tab${kind === 'static' ? ' is-active' : ''}`}
            onClick={() => setKind('static')}
          >
            Static
          </button>
        </div>

        <label className="label">
          Title
          <input
            className="input"
            value={title}
            placeholder={kind === 'static' ? 'Poster in Berlin' : 'Spring newsletter'}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        {kind === 'dynamic' ? (
          <label className="label">
            Where should it point?
            <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="url">A destination URL</option>
              {links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title || l.slug} → {l.destination_url}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {kind === 'dynamic' && target === 'url' ? (
          <label className="label">
            Destination URL
            <input
              className="input"
              value={url}
              placeholder="https://example.com"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
        ) : null}

        {kind === 'static' ? (
          <label className="label">
            Content to encode
            <textarea
              className="textarea"
              rows={3}
              value={content}
              placeholder={'https://example.com\nWIFI:T:WPA;S:network;;\nMAILTO:someone@example.com'}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
        ) : null}

        <div className="callout callout-accent">
          Encodes <code>{preview}</code>
          {kind === 'static' ? (
            <>
              {' '}— a static code cannot be redirected later. Gradients, frames and logos are
              also unsupported on static codes.
            </>
          ) : (
            <> — edit the destination for this code later, without reprinting.</>
          )}
        </div>

        {error ? <p className="callout callout-danger">{error}</p> : null}

        <div className="toolbar-group">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || (kind === 'dynamic' && target === 'url' && !url) || (kind === 'static' && !content)}
            onClick={create}
          >
            {pending ? 'Creating…' : 'Create code'}
          </button>
        </div>
      </section>

      <section className="card card-pad" style={{ display: 'grid', gap: '1rem' }}>
        <div className="section-head">
          <div>
            <h2 className="section-title">Design</h2>
            <p className="section-sub">
              Applied at print time. Options marked approximate are the closest the renderer can
              produce to the named shape.
            </p>
          </div>
        </div>
        <QrDesigner content={preview} value={design} onChange={setDesign} />
      </section>

      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="card-pad" style={{ paddingBottom: '0.75rem' }}>
          <h2 className="section-title">Your codes</h2>
          <p className="section-sub">
            {codes.length === 0 ? 'No codes yet.' : `${codes.length} code${codes.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {codes.length === 0 ? (
          <div className="empty-state" style={{ borderTop: '1px solid var(--border)' }}>
            <strong>Nothing here yet</strong>
            Create your first code above and it will appear here.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Points to</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Image</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 550 }}>{c.title || <span style={{ color: 'var(--muted)' }}>Untitled</span>}</td>
                  <td>
                    <span className="badge">{c.kind === 'static' ? 'Static' : 'Managed'}</span>
                  </td>
                  <td style={{ color: 'var(--muted)' }}>{c.target}</td>
                  <td>
                    <span
                      className={`badge ${
                        c.expiration === 'expired'
                          ? 'badge-danger'
                          : c.expiration === 'expiring'
                            ? 'badge-warning'
                            : 'badge-success'
                      }`}
                    >
                      {c.expiration === 'none' ? 'No expiry' : c.expiration}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="toolbar-group" style={{ justifyContent: 'flex-end' }}>
                      {(['png', 'jpeg', 'svg'] as const).map((fmt) => (
                        <a
                          key={fmt}
                          className="btn btn-ghost btn-xs"
                          href={`/api/v1/qr-codes/${c.id}/image?format=${fmt}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {fmt.toUpperCase()}
                        </a>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}