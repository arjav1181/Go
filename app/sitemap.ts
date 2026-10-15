import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://go.arjav.is-cool.dev';

/**
 * Only genuinely public, stable pages are listed.
 *
 * Short links are deliberately excluded. They are dynamic, they redirect to
 * third-party destinations, and listing them would associate arbitrary external
 * content with this domain in search results.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // `lastModified` is deliberately omitted. Emitting `new Date()` would mark
  // every page as freshly modified on each deployment, which tells crawlers
  // something untrue and encourages pointless re-crawling. It is optional.
  return [
    {
      url: `${SITE_URL}/`,
      changeFrequency: 'monthly',
      priority: 1
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: 'yearly',
      priority: 0.5
    },
    {
      url: `${SITE_URL}/terms`,
      changeFrequency: 'yearly',
      priority: 0.5
    }
  ];
}
