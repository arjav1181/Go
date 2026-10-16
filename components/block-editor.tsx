'use client';

import { useState } from 'react';
import {
  BLOCK_TYPES,
  MAX_BLOCKS_PER_PAGE,
  type PageBlock,
  type BlockType
} from '@/lib/pages/blocks';
import { isBlockVisible } from '@/lib/pages/blocks';

/**
 * Block editor.
 *
 * Covers the spec's editing behaviours: add, reorder by drag, pin to the top,
 * disable, and schedule a block to appear and/or unpublish later. Draft state
 * lives with the parent, which owns the server action.
 *
 * Reordering moves only `position`; it never regenerates `blockId`, because
 * per-block click analytics aggregates on that value and re-minting it on every
 * drag would silently reset a block's stats.
 */

export interface BlockEditorProps {
  blocks: PageBlock[];
  onChange: (next: PageBlock[]) => void;
  /** blockId -> clicks, for the per-block performance hint. */
  stats?: Record<string, number>;
}

export function BlockEditor({ blocks, onChange, stats = {} }: BlockEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const ordered = [...blocks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.position - b.position;
  });

  function commit(next: PageBlock[]) {
    // Renumber into gaps of 10 so a later insert needs no renumber pass.
    onChange(next.map((b, i) => ({ ...b, position: i * 10 })));
  }

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...ordered];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  }

  function update(blockId: string, patch: Partial<PageBlock>) {
    commit(blocks.map((b) => (b.blockId === blockId ? ({ ...b, ...patch } as PageBlock) : b)));
  }

  function remove(blockId: string) {
    commit(blocks.filter((b) => b.blockId !== blockId));
  }

  function addBlock(type: BlockType) {
    if (blocks.length >= MAX_BLOCKS_PER_PAGE) return;
    const nextPos = blocks.length ? Math.max(...blocks.map((b) => b.position)) + 10 : 0;
    const blockId = crypto.randomUUID();
    const base = { blockId, position: nextPos, pinned: false };

    let block: PageBlock;
    switch (type) {
      case 'link':
        block = { ...base, type: 'link', label: 'New link', href: '' };
        break;
      case 'text':
        block = { ...base, type: 'text', text: '', style: 'body' };
        break;
      case 'image':
        block = { ...base, type: 'image', url: '', alt: '' };
        break;
      case 'image_grid':
      case 'image_carousel':
        block = { ...base, type, images: [] };
        break;
      case 'youtube':
        block = { ...base, type: 'youtube', videoId: '' };
        break;
      case 'contact':
        block = { ...base, type: 'contact', showEmail: true, showPhone: false, allowDownload: true };
        break;
      case 'social':
        block = { ...base, type: 'social', networks: [] };
        break;
    }
    commit([...blocks, block]);
  }

  return (
    <div className="block-editor card card-pad">
      <div className="block-editor-add">
        <span className="block-editor-add-label">Add block</span>
        <div className="block-editor-add-buttons">
          {BLOCK_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="btn btn-ghost"
              disabled={blocks.length >= MAX_BLOCKS_PER_PAGE}
              onClick={() => addBlock(t)}
            >
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <ol className="block-editor-list">
        {ordered.map((block, index) => (
          <li
            key={block.blockId}
            className={[
              'block-editor-item',
              dragIndex === index ? 'is-dragging' : '',
              overIndex === index && dragIndex !== null && dragIndex !== index ? 'is-over' : '',
              block.pinned ? 'is-pinned' : '',
              isBlockVisible(block) ? '' : 'is-hidden'
            ]
              .filter(Boolean)
              .join(' ')}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragEnter={() => setOverIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            <div className="block-editor-head">
              <span className="block-editor-grip" aria-hidden="true">
                ⠿
              </span>
              <span className="block-editor-type">{block.type.replace('_', ' ')}</span>
              {block.pinned ? <span className="badge">pinned</span> : null}
              {!isBlockVisible(block) ? (
                <span className="badge is-warn">hidden</span>
              ) : null}
              {stats[block.blockId] ? (
                <span className="badge">{stats[block.blockId]} clicks</span>
              ) : null}

              <span className="block-editor-actions">
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => move(index, Math.max(0, index - 1))}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => move(index, Math.min(ordered.length - 1, index + 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => update(block.blockId, { pinned: !block.pinned })}
                >
                  {block.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => update(block.blockId, { disabled: !block.disabled })}
                >
                  {block.disabled ? 'Enable' : 'Disable'}
                </button>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => remove(block.blockId)}>
                  Remove
                </button>
              </span>
            </div>

            <BlockFields block={block} onChange={(patch) => update(block.blockId, patch)} />
          </li>
        ))}
      </ol>

      {!ordered.length ? (
        <p className="empty-state">No blocks yet. Add one above, or start from a template.</p>
      ) : null}
    </div>
  );
}

function BlockFields({
  block,
  onChange
}: {
  block: PageBlock;
  onChange: (patch: Partial<PageBlock>) => void;
}) {
  return (
    <div className="block-editor-fields">
      <ScheduleField block={block} onChange={onChange} />

      {block.type === 'link' && (
        <>
          <Field label="Label">
            <input className="input" value={block.label} onChange={(e) => onChange({ label: e.target.value } as Partial<PageBlock>)} />
          </Field>
          <Field label="Description">
            <input
              value={block.description ?? ''}
              onChange={(e) => onChange({ description: e.target.value } as Partial<PageBlock>)}
            />
          </Field>
          <Field label="Destination URL">
            <input
              value={block.href ?? ''}
              placeholder="https://…"
              onChange={(e) => onChange({ href: e.target.value } as Partial<PageBlock>)}
            />
          </Field>
        </>
      )}

      {block.type === 'text' && (
        <>
          <Field label="Style">
            <select
              className="select"
              value={block.style}
              onChange={(e) => onChange({ style: e.target.value as 'body' | 'heading' } as Partial<PageBlock>)}
            >
              <option value="body">Body</option>
              <option value="heading">Heading</option>
            </select>
          </Field>
          <Field label="Text">
            <textarea
              className="textarea"
              rows={3}
              value={block.text}
              onChange={(e) => onChange({ text: e.target.value } as Partial<PageBlock>)}
            />
          </Field>
        </>
      )}

      {block.type === 'image' && (
        <>
          <Field label="Image URL">
            <input className="input" value={block.url} onChange={(e) => onChange({ url: e.target.value } as Partial<PageBlock>)} />
          </Field>
          <Field label="Alt text">
            <input className="input" value={block.alt} onChange={(e) => onChange({ alt: e.target.value } as Partial<PageBlock>)} />
          </Field>
          <Field label="Optional outbound link">
            <input value={block.href ?? ''} onChange={(e) => onChange({ href: e.target.value || undefined } as Partial<PageBlock>)} />
          </Field>
        </>
      )}

      {(block.type === 'image_grid' || block.type === 'image_carousel') && (
        <Field label="Images (one URL per line, optionally `url | alt text | link`)">
          <textarea
            className="textarea"
            rows={4}
            defaultValue={block.images
              .map((i) => [i.url, i.alt, i.href ?? ''].filter(Boolean).join(' | '))
              .join('\n')}
            onBlur={(e) => onChange({ images: parseImageLines(e.target.value) } as Partial<PageBlock>)}
          />
        </Field>
      )}

      {block.type === 'youtube' && (
        <Field label="YouTube URL or id">
          <input className="input" value={block.videoId} onChange={(e) => onChange({ videoId: e.target.value } as Partial<PageBlock>)} />
        </Field>
      )}

      {block.type === 'contact' && (
        <>
          <Field label="Show email">
            <input
              type="checkbox"
              checked={block.showEmail}
              onChange={(e) => onChange({ showEmail: e.target.checked } as Partial<PageBlock>)}
            />
          </Field>
          <Field label="Show phone">
            <input
              type="checkbox"
              checked={block.showPhone}
              onChange={(e) => onChange({ showPhone: e.target.checked } as Partial<PageBlock>)}
            />
          </Field>
          <Field label="Allow vCard download">
            <input
              type="checkbox"
              checked={block.allowDownload}
              onChange={(e) => onChange({ allowDownload: e.target.checked } as Partial<PageBlock>)}
            />
          </Field>
        </>
      )}

      {block.type === 'social' && (
        <Field label="Networks (one `network url` per line)">
          <textarea
            className="textarea"
            rows={3}
            defaultValue={block.networks.map((n) => `${n.network} ${n.href}`).join('\n')}
            onBlur={(e) => onChange({ networks: parseSocialLines(e.target.value) } as Partial<PageBlock>)}
          />
        </Field>
      )}
    </div>
  );
}

function ScheduleField({
  block,
  onChange
}: {
  block: PageBlock;
  onChange: (patch: Partial<PageBlock>) => void;
}) {
  const toLocalInput = (ms?: number) => (ms ? new Date(ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

  return (
    <div className="block-editor-schedule">
      <Field label="Appears from">
        <input
          className="input"
          type="datetime-local"
          value={toLocalInput(block.schedule?.from)}
          onChange={(e) => {
            const from = e.target.value ? new Date(e.target.value).getTime() : undefined;
            onChange({ schedule: { ...block.schedule, from } } as Partial<PageBlock>);
          }}
        />
      </Field>
      <Field label="Until">
        <input
          className="input"
          type="datetime-local"
          value={toLocalInput(block.schedule?.until)}
          onChange={(e) => {
            const until = e.target.value ? new Date(e.target.value).getTime() : undefined;
            onChange({ schedule: { ...block.schedule, until } } as Partial<PageBlock>);
          }}
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="label">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** `url | alt | link` per line. Invalid lines are dropped by `parseBlocks`. */
function parseImageLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [url, alt, href] = line.split('|').map((p) => p.trim());
      return { url, alt: alt ?? '', ...(href ? { href } : {}) };
    });
}

function parseSocialLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [network, ...rest] = line.split(/\s+/);
      return { network, href: rest.join(' ') };
    })
    .filter((n) => n.network && n.href);
}