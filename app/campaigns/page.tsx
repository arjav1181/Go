import Link from 'next/link';
import { requireOwner } from '@/lib/auth/owner';
import { loadCampaigns } from '@/lib/campaigns/listing';

export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const owner = await requireOwner();
  const { campaigns, totalClicks, windowDays } = await loadCampaigns(owner.id);

  return (
    <div className="page-wrap">
      <header className="page-head">
        <h1 className="page-title">Campaigns</h1>
        <p className="page-lede">
          Group your links by campaign and distribution channel so you can compare where traffic
          actually came from. A channel becomes the <code>utm_source</code> value; the medium is
          recorded as <code>go</code>.
        </p>
      </header>

      {campaigns.length === 0 ? (
        <div className="card empty-state">
          <strong>No campaigns yet</strong>
          Campaigns group links so you can compare channels. Create one to start splitting traffic
          by source.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1.25rem' }}>
          <div className="toolbar">
            <div className="toolbar-group">
              <span className="badge badge-accent">
                {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}
              </span>
              <span className="badge">{totalClicks} clicks in {windowDays} days</span>
            </div>
            <div className="toolbar-group">
              <Link className="btn btn-ghost btn-sm" href="/links/new">
                Create a link
              </Link>
            </div>
          </div>

          {campaigns.map((campaign) => (
            <section key={campaign.id} className="card" style={{ overflow: 'hidden' }}>
              <div className="card-pad">
                <div className="section-head">
                  <div>
                    <h2 className="section-title">{campaign.name}</h2>
                    {campaign.description ? (
                      <p className="section-sub">{campaign.description}</p>
                    ) : null}
                  </div>
                  <span className="badge">
                    {campaign.channels.length} channel{campaign.channels.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              {campaign.channels.length === 0 ? (
                <div className="empty-state" style={{ borderTop: '1px solid var(--border)' }}>
                  A campaign needs at least one channel before links can be attached to it.
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Channel</th>
                      <th>utm_source</th>
                      <th>utm_medium</th>
                      <th style={{ textAlign: 'right' }}>Links</th>
                      <th style={{ textAlign: 'right' }}>Clicks (30d)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaign.channels.map((ch) => {
                      const max = Math.max(
                        1,
                        ...campaign.channels.map((x) => x.clicks)
                      );
                      return (
                        <tr key={ch.id}>
                          <td style={{ fontWeight: 550 }}>{ch.name}</td>
                          <td>
                            <code style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                              {ch.name}
                            </code>
                          </td>
                          <td>
                            <code style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                              {ch.utm_medium}
                            </code>
                          </td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                            {ch.link_count}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                justifyContent: 'flex-end'
                              }}
                            >
                              <span
                                style={{
                                  display: 'block',
                                  height: '6px',
                                  width: `${Math.max(3, (ch.clicks / max) * 70)}px`,
                                  borderRadius: '999px',
                                  background: 'var(--accent)',
                                  opacity: ch.clicks === 0 ? 0.2 : 1
                                }}
                              />
                              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 550 }}>
                                {ch.clicks}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}