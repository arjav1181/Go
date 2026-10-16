'use client';

import { useState, useTransition } from 'react';
import { BlockEditor } from '@/components/block-editor';
import type { PageBlock } from '@/lib/pages/blocks';
import {
  savePageDraft,
  publishPage,
  unpublishPage,
  type PageEditorResult
} from '@/app/actions/page-editor';
import type { PageStats } from '@/lib/pages/analytics';

/**
 * Page editor panel.
 *
 * The Save / Publish split is the whole point of this screen: the spec requires
 * that changes persist as a draft and only go live when Publish is pressed, so
 * the two actions are visually and behaviourally distinct rather than one
 * "Save" that happens to do both.
 */

export interface PageEditorPanelProps {
  pageId: string;
  initialBlocks: unknown[];
  stats: PageStats;
  blockStats: Record<string, number>;
  isPublished: boolean;
  hasUnpublished: boolean;
  handle: string;
  publicUrl: string;
}

export function PageEditorPanel(props: PageEditorPanelProps) {
  const [blocks, setBlocks] = useState<PageBlock[]>(props.initialBlocks as PageBlock[]);
  const [scheduledPublishAt, setScheduledPublishAt] = useState('');
  const [scheduledUnpublishAt, setScheduledUnpublishAt] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PageEditorResult | null>(null);
  const [unpublished, setUnpublished] = useState(props.hasUnpublished);

  function update(next: PageBlock[]) {
    setBlocks(next);
    setDirty(true);
  }

  function run(fn: () => Promise<PageEditorResult>) {
    startTransition(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        setDirty(false);
        if (typeof res.hasUnpublishedChanges === 'boolean') setUnpublished(res.hasUnpublishedChanges);
      }
    });
  }

  const ctr =
    props.stats.clickThroughRate === null
      ? '—'
      : `${(props.stats.clickThroughRate * 100).toFixed(1)}%`;

  return (
    <section className="page-editor-panel">
      <div className="page-editor-head">
        <div>
          <h2 className="text-lg font-semibold">Page</h2>
          <p className="text-sm text-[var(--muted)]">
            <a href={props.publicUrl} target="_blank" rel="noreferrer">
              {props.publicUrl}
            </a>
          </p>
        </div>
        <div className="page-editor-metrics">
          <span>
            <b>{props.stats.views}</b> views
          </span>
          <span>
            <b>{props.stats.clicks}</b> clicks
          </span>
          <span>
            <b>{ctr}</b> CTR
          </span>
          <span className={props.isPublished ? 'page-editor-live' : 'page-editor-draft'}>
            {props.isPublished ? 'Live' : 'Draft'}
          </span>
          {unpublished ? <span className="badge">unpublished changes</span> : null}
        </div>
      </div>

      <div className="page-editor-schedule">
        <label>
          <span>Publish at (optional)</span>
          <input
            type="datetime-local"
            value={scheduledPublishAt}
            onChange={(e) => setScheduledPublishAt(e.target.value)}
          />
        </label>
        <label>
          <span>Unpublish at (optional)</span>
          <input
            type="datetime-local"
            value={scheduledUnpublishAt}
            onChange={(e) => setScheduledUnpublishAt(e.target.value)}
          />
        </label>
      </div>

      <BlockEditor blocks={blocks} onChange={update} stats={props.blockStats} />

      <div className="page-editor-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={() =>
            run(() =>
              savePageDraft({
                draft_blocks: blocks,
                scheduled_publish_at: scheduledPublishAt ? new Date(scheduledPublishAt).toISOString() : null,
                scheduled_unpublish_at: scheduledUnpublishAt ? new Date(scheduledUnpublishAt).toISOString() : null
              })
            )
          }
        >
          Save draft
        </button>

        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              // Publishing an unsaved draft would silently discard the edits the
              // editor just made, so save first, then publish.
              const saved = await savePageDraft({
                draft_blocks: blocks,
                scheduled_publish_at: scheduledPublishAt ? new Date(scheduledPublishAt).toISOString() : null,
                scheduled_unpublish_at: scheduledUnpublishAt ? new Date(scheduledUnpublishAt).toISOString() : null
              });
              if (!saved.ok) return saved;
              return publishPage();
            })
          }
        >
          Publish changes
        </button>

        {props.isPublished ? (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(unpublishPage)}>
            Unpublish
          </button>
        ) : null}

        {dirty ? <span className="badge badge-warning">unsaved changes</span> : null}
      </div>

      {result?.error ? <p className="callout callout-danger">{result.error}</p> : null}
      {result?.warnings?.length ? (
        <ul className="callout callout-warning">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}