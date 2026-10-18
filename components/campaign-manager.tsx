'use client';

import { useState, useTransition } from 'react';
import {
  createCampaign,
  addChannel,
  type CampaignResult
} from '@/app/actions/campaigns';

export interface ChannelActionTarget {
  id: string;
  name: string;
}

/**
 * Campaign and channel management.
 *
 * The list page was read-only: it could show campaigns but there was no way to
 * make one, which made the whole feature unusable from the UI. The database
 * triggers enforce the limits, so this surface reports the specific limit the
 * user hit rather than a generic failure.
 */
export function CampaignManager({ campaigns }: { campaigns: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [channel, setChannel] = useState('');
  const [medium, setMedium] = useState('go');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res: CampaignResult = await createCampaign({
        name,
        description,
        channelName: channel || name,
        utmMedium: medium
      });
      if (res.ok) {
        setOpen(false);
        setName('');
        setDescription('');
        setChannel('');
        window.location.reload();
        return;
      }
      setError(res.error ?? 'Could not create the campaign.');
    });
  }

  return (
    <section className="card card-pad" style={{ display: 'grid', gap: '1rem' }}>
      <div className="section-head">
        <div>
          <h2 className="section-title">Campaigns</h2>
          <p className="section-sub">
            Every campaign starts with one channel. A channel becomes the <code>utm_source</code>{' '}
            value on your links.
          </p>
        </div>
        <button
          type="button"
          className={open ? 'btn btn-secondary' : 'btn btn-primary'}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Cancel' : 'New campaign'}
        </button>
      </div>

      {open ? (
        <form onSubmit={submit} style={{ display: 'grid', gap: '0.85rem' }}>
          <div style={{ display: 'grid', gap: '0.85rem', gridTemplateColumns: 'repeat(auto-fit,minmax(14rem,1fr))' }}>
            <label className="label">
              Campaign name
              <input
                className="input"
                required
                maxLength={80}
                value={name}
                placeholder="Spring launch"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="label">
              First channel
              <input
                className="input"
                required
                maxLength={80}
                value={channel}
                placeholder="newsletter"
                onChange={(e) => setChannel(e.target.value)}
              />
            </label>
            <label className="label">
              utm_medium
              <input
                className="input"
                maxLength={80}
                value={medium}
                onChange={(e) => setMedium(e.target.value)}
              />
            </label>
          </div>

          <label className="label">
            Description
            <input
              className="input"
              maxLength={280}
              value={description}
              placeholder="Optional — what this campaign is for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="callout callout-accent">
            Links in this campaign will point at your own domain, and the destination will be
            tagged <code>utm_source</code> with the channel and <code>utm_campaign</code> with the
            campaign name.
          </div>

          {error ? <p className="callout callout-danger">{error}</p> : null}

          <div className="toolbar-group">
            <button type="submit" className="btn btn-primary" disabled={pending || !name.trim()}>
              {pending ? 'Creating…' : 'Create campaign'}
            </button>
          </div>
        </form>
      ) : null}

      {campaigns.length ? <ChannelLists campaigns={campaigns} /> : null}
    </section>
  );
}

function ChannelLists({ campaigns }: { campaigns: Array<{ id: string; name: string }> }) {
  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      {campaigns.map((c) => (
        <ChannelAdder key={c.id} campaignId={c.id} campaignName={c.name} />
      ))}
    </div>
  );
}

function ChannelAdder({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [medium, setMedium] = useState('go');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addChannel({ campaignId, name, utmMedium: medium });
      if (res.ok) {
        setAdding(false);
        setName('');
        window.location.reload();
        return;
      }
      setError(res.error ?? 'Could not add the channel.');
    });
  }

  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: '0.88rem', color: 'var(--muted)' }}>
        Add a channel to <b style={{ color: 'var(--fg)' }}>{campaignName}</b>
      </summary>

      {adding ? (
        <form
          onSubmit={submit}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem', alignItems: 'flex-end' }}
        >
          <label className="label" style={{ flex: '1 1 12rem' }}>
            Channel name
            <input
              className="input"
              required
              maxLength={80}
              value={name}
              placeholder="instagram"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="label" style={{ flex: '0 1 8rem' }}>
            utm_medium
            <input className="input" maxLength={80} value={medium} onChange={(e) => setMedium(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={pending || !name.trim()}>
            {pending ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
            Cancel
          </button>
          {error ? <p className="callout callout-danger" style={{ flexBasis: '100%' }}>{error}</p> : null}
        </form>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setAdding(true)}>
          Add channel
        </button>
      )}
    </details>
  );
}
