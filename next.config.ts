import path from 'node:path';

import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * The Content-Security-Policy is deliberately strict: this application renders
 * no third-party scripts, no analytics and no external assets. `connect-src`
 * is limited to Supabase and same-origin, which blocks exfiltration if markup
 * were ever injected. `'unsafe-inline'` is retained for styles only, which
 * Tailwind's injected style blocks require.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Next.js emits inline bootstrap scripts
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", // QR previews are object URLs
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests"
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,

  /**
   * `/@handle` is a nicer bio URL, but `@` is Next.js's parallel-route marker
   * and cannot be a literal directory name. Rewrite it to an internal route.
   *
   * Slugs cannot contain `@` (the slug charset is `[a-z0-9_-]`), so this can
   * never shadow a short link.
   */
  async rewrites() {
    return [{ source: '/@:handle', destination: '/bio/:handle' }];
  },

  // Pin the build root to this package. Without it, Turbopack walks up looking
  // for a lockfile and can resolve modules from an unrelated parent directory,
  // which produces a build that only works on the machine that made it.
  turbopack: {
    root: path.join(__dirname)
  },
  async headers() {
    // HSTS is meaningless (and actively breaks plain-http localhost dev), so it
    // is only emitted for production traffic.
    const isProduction = process.env.NODE_ENV === 'production';

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-Download-Options', value: 'noopen' },
          ...(isProduction
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
            : [])
        ]
      }
    ];
  }
};

export default nextConfig;