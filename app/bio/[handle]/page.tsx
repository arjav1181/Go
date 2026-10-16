import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { loadBioPage, safeAccentColor, safeBioHref, normalizeHandle } from '@/lib/links/bio';

export const dynamic = 'force-dynamic';

type Params = Promise<{ handle: string }>;

async function getPage(handle: string) {
  return loadBioPage(handle);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params;
  const page = await getPage(normalizeHandle(handle));

  if (!page) return { title: 'Not found' };

  const title = page.displayName;
  const description = page.bio || `Links from ${page.displayName}.`;

  return {
    title,
    description: description.slice(0, 200),
    // A bio page is public and meant to be found. Unlike every other page in
    // the product it is intentionally indexable.
    robots: page.links.length > 0 ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: 'profile',
      title,
      description: description.slice(0, 200),
      ...(page.avatarUrl ? { images: [{ url: page.avatarUrl }] } : {})
    }
  };
}

export default async function BioPageRoute({ params }: { params: Params }) {
  const { handle } = await params;
  const page = await getPage(normalizeHandle(handle));
  if (!page) notFound();

  const accent = safeAccentColor(page.accentColor);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-16">
      <header className="flex flex-col items-center text-center">
        {page.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.avatarUrl}
            alt=""
            aria-hidden
            className="h-20 w-20 rounded-full object-cover"
            style={{ borderColor: accent }}
          />
        ) : (
          <div
            aria-hidden
            className="grid h-20 w-20 place-items-center rounded-full font-mono text-2xl font-bold"
            style={{ background: accent, color: '#fff' }}
          >
            {page.displayName.slice(0, 1).toUpperCase()}
          </div>
        )}

        <h1 className="mt-5 text-heading-24 text-primary">{page.displayName}</h1>
        {page.bio ? <p className="mt-2 max-w-md text-copy-14 text-secondary">{page.bio}</p> : null}
      </header>

      {page.links.length === 0 ? (
        <p className="mt-12 text-center text-copy-13 text-tertiary">No links published yet.</p>
      ) : (
        <ul
          className={
            page.theme === 'grid'
              ? 'mt-10 grid gap-3 sm:grid-cols-2'
              : 'mt-10 flex flex-col gap-3'
          }
        >
          {page.links.map((link) => {
            const href = safeBioHref(link.destinationUrl);
            return (
              <li key={link.slug}>
                <a
                  href={href ?? '#'}
                  // Only ever http/https, enforced in safeBioHref.
                  {...(href ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
                  aria-disabled={href ? undefined : true}
                  className="group flex items-center justify-between gap-4 rounded-xl border border-[var(--ds-gray-400)] bg-[var(--ds-background-100)] px-5 py-4 transition-colors hover:bg-[var(--ds-background-200)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-label-14 text-primary">{link.title}</span>
                    {link.description ? (
                      <span className="mt-0.5 block truncate text-label-12 text-tertiary">
                        {link.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-label-12 text-tertiary">/{link.slug}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}