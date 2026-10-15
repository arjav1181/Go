import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://go.arjav.is-cool.dev';

/**
 * Allow the public pages, discourage crawling the private ones.
 *
 * This previously disallowed `/` for every user agent, so the landing page,
 * privacy page and terms page could never appear in a search result.
 *
 * Two corrections worth recording, because both look plausible and neither
 * works:
 *
 *   - `Disallow: /*` cannot be partially undone with `Disallow: !/$`. The `!`
 *     exclusion syntax belongs to Apache and nginx rewrite rules; robots.txt
 *     has no negation operator. With that combination every URL is still
 *     blocked, including `/`.
 *   - robots.txt resolves overlapping Allow/Disallow by longest match, so a
 *     broad `Allow: /` loses to any more specific `Disallow`. Private paths are
 *     therefore listed individually rather than behind a wildcard.
 *
 * Note that `Disallow` is a crawler hint, not access control. Every private
 * route is independently gated server-side; this only stops crawlers spending
 * requests on pages that will refuse them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/auth/',
          '/dashboard',
          '/links/',
          '/settings',
          '/tags'
        ]
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
