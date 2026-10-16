import Link from 'next/link';
import type { PageBlock, SocialNetwork } from '@/lib/pages/blocks';

/**
 * Public renderer for a published page.
 *
 * Server component. Every outbound href arrives pre-validated by `parseBlocks`
 * (http/https only) and is re-checked here, because this is the component that
 * actually emits the anchor and the trust boundary belongs at the emit point,
 * not only at the parse boundary.
 */

export interface PageLink {
  slug: string;
  label: string;
  description: string;
  href: string;
}

export interface PageImage {
  url: string;
  alt: string;
  href?: string;
}

export interface PageViewProps {
  handle: string;
  displayName: string;
  bioText: string;
  avatarUrl: string;
  accentColor: string;
  pageId?: string;
  links?: PageLink[];
  blocks?: PageBlock[];
  contact?: { name: string; email: string; phone: string };
}

export function PageView(props: PageViewProps) {
  const { handle, displayName, bioText, avatarUrl, accentColor, links, blocks, contact } = props;

  /**
   * Block clicks are counted by `/p/[pageId]/[blockId]`, which records the
   * click server-side and then redirects. Doing it that way rather than with a
   * client-side beacon means the count survives a blocked script, and a
   * countdown that depends on JavaScript is a number nobody can trust.
   */
  const content = blocks?.length
    ? <BlockList blocks={blocks} contact={contact} pageId={props.pageId} pageHandle={handle} />
    : <LegacyLinkList links={links ?? []} pageId={props.pageId} pageHandle={handle} />;

  return (
    <main
      className="page-view"
      style={{ ['--page-accent' as string]: accentColor }}
      data-page-id={props.pageId}
    >
      <header className="page-view-header">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="page-view-avatar" src={avatarUrl} alt="" width={96} height={96} />
        ) : null}
        <h1 className="page-view-name">{displayName}</h1>
        {bioText ? <p className="page-view-bio">{bioText}</p> : null}
      </header>
      <div className="page-view-body">{content}</div>
      <footer className="page-view-footer">
        <Link href="/" className="page-view-powered">
          Powered by go.
        </Link>
        <span className="page-view-handle">@{handle}</span>
      </footer>
    </main>
  );
}

function LegacyLinkList({
  links,
  pageId,
  pageHandle
}: {
  links: PageLink[];
  pageId?: string;
  pageHandle?: string;
}) {
  if (!links.length) {
    return <p className="page-view-empty">No links yet.</p>;
  }
  return (
    <ul className="page-link-list">
      {links.map((l) => (
        <li key={l.slug}>
          <a
            className="page-link"
            href={blockHref(pageId, pageHandle, `legacy-${l.slug}`, l.href)}
            rel="noopener nofollow"
          >
            <span className="page-link-label">{l.label}</span>
            {l.description ? <span className="page-link-desc">{l.description}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Route an outbound link through the click counter.
 *
 * Falls back to the raw href when the page has no id, so a block is never
 * rendered uncountable — a slightly undercounted page beats a broken link.
 */
function blockHref(
  pageId: string | undefined,
  pageHandle: string | undefined,
  blockId: string,
  href: string
): string {
  if (!pageId || !pageHandle) return href;
  const safe = safeHref(href);
  if (!safe) return '#';
  return `/p/${encodeURIComponent(pageHandle)}/${encodeURIComponent(blockId)}?to=${encodeURIComponent(safe)}`;
}

function BlockList({
  blocks,
  contact,
  pageId,
  pageHandle
}: {
  blocks: PageBlock[];
  contact?: { name: string; email: string; phone: string };
  pageId?: string;
  pageHandle?: string;
}) {
  if (!blocks.length) return <p className="page-view-empty">This page has no visible blocks yet.</p>;
  return (
    <div className="page-blocks">
      {blocks.map((block) => (
        <Block key={block.blockId} block={block} contact={contact} pageId={pageId} pageHandle={pageHandle} />
      ))}
    </div>
  );
}

function Block({
  block,
  contact,
  pageId,
  pageHandle
}: {
  block: PageBlock;
  contact?: { name: string; email: string; phone: string };
  pageId?: string;
  pageHandle?: string;
}) {
  switch (block.type) {
    case 'text': {
      const Tag = block.style === 'heading' ? 'h2' : 'p';
      const body = block.text;
      return block.style === 'heading' ? (
        <h2 className="page-block-text page-block-heading">{body}</h2>
      ) : (
        <Tag className="page-block-text">{body}</Tag>
      );
    }

    case 'link': {
      // Either a Bitly link (measured, editable) or an external href.
      if (block.linkId && !block.href) {
        return (
          <div className="page-block-link">
            <span className="page-block-unresolved" title="Attach this link before publishing">
              {block.label || 'Unlinked'}
            </span>
          </div>
        );
      }
      const href = block.href ? safeHref(block.href) : null;
      if (!href) return null;
      return (
        <div className="page-block-link">
          <a
            className="page-link"
            href={blockHref(pageId, pageHandle, block.blockId, href)}
            target="_blank"
            rel="noopener nofollow"
          >
            {block.thumbnailUrl && safeHref(block.thumbnailUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="page-link-thumb" src={safeHref(block.thumbnailUrl) as string} alt="" width={56} height={56} />
            ) : null}
            <span>
              <span className="page-link-label">{block.label}</span>
              {block.description ? <span className="page-link-desc">{block.description}</span> : null}
            </span>
          </a>
        </div>
      );
    }

    case 'image':
      return <SingleImage image={block} />;

    case 'image_grid':
      return (
        <div className="page-block-grid">
          {block.images.map((img, i) => (
            <SingleImage key={`${block.blockId}-${i}`} image={img} />
          ))}
        </div>
      );

    case 'image_carousel':
      return (
        <div className="page-block-carousel" role="group" aria-label="Image carousel">
          {block.images.map((img, i) => (
            <div className="page-carousel-slide" key={`${block.blockId}-${i}`}>
              <SingleImage image={img} />
            </div>
          ))}
        </div>
      );

    case 'youtube': {
      const start = block.startAt ? `&start=${block.startAt}` : '';
      return (
        <div className="page-block-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${block.videoId}?rel=0${start}`}
            title={block.title ?? 'YouTube video'}
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            width={560}
            height={315}
          />
        </div>
      );
    }

    case 'contact': {
      const c = contact ?? { name: '', email: '', phone: '' };
      // vCard is the measured "download contact" action from the spec.
      const vcard = buildVCard(c);
      return (
        <div className="page-block-contact">
          {c.name ? <p className="page-contact-name">{c.name}</p> : null}
          {block.showEmail && c.email ? (
            <a className="page-contact-line" href={`mailto:${c.email}`}>
              {c.email}
            </a>
          ) : null}
          {block.showPhone && c.phone ? (
            <a className="page-contact-line" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
              {c.phone}
            </a>
          ) : null}
          {block.allowDownload && vcard ? (
            <a className="page-contact-download" href={blockHref(pageId, pageHandle, block.blockId, `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`)}>
              {block.label || 'Save contact'}
            </a>
          ) : null}
        </div>
      );
    }

    case 'social':
      return (
        <ul className="page-block-social">
          {block.networks.map((n) => {
            const href = safeHref(n.href);
            if (!href) return null;
            return (
              <li key={`${block.blockId}-${n.network}`}>
                <a href={href} target="_blank" rel="noopener nofollow" aria-label={n.network}>
                  <SocialIcon network={n.network} />
                </a>
              </li>
            );
          })}
        </ul>
      );

    default:
      return null;
  }
}

function SingleImage({ image }: { image: { url: string; alt: string; href?: string } }) {
  const url = safeHref(image.url);
  if (!url) return null;
  const inner = (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="page-block-image" src={url} alt={image.alt} loading="lazy" />
  );
  const href = image.href ? safeHref(image.href) : null;
  return href ? (
    <a href={href} target="_blank" rel="noopener nofollow">
      {inner}
    </a>
  ) : (
    inner
  );
}

/** Last gate before an href reaches the DOM. */
function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return value;
  } catch {
    return null;
  }
}

/** Minimal vCard 3.0. Values are sanitised because they become a file the visitor downloads. */
function buildVCard(c: { name: string; email: string; phone: string }): string {
  const clean = (s: string) => s.replace(/[\r\n]/g, ' ').trim();
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  if (clean(c.name)) lines.push(`FN:${clean(c.name)}`);
  if (clean(c.email)) lines.push(`EMAIL:${clean(c.email)}`);
  if (clean(c.phone)) lines.push(`TEL:${clean(c.phone).replace(/[^\d+]/g, '')}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  x: 'X',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  github: 'GitHub',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  threads: 'Threads'
};

function SocialIcon({ network }: { network: SocialNetwork }) {
  return <span className="page-social-icon">{SOCIAL_LABELS[network]}</span>;
}

