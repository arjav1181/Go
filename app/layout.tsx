import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import type { ReactNode } from 'react';
import { getCurrentUser } from '@/lib/auth/owner';
import AppShell from '@/components/app-shell';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://go.arjav.is-cool.dev';
const TITLE = 'go. — short links on a domain you own';
const DESCRIPTION =
  'Memorable short links on your own domain. Aggregate analytics that store no IP addresses, ' +
  'no cookies and no visitor identifiers. Scheduled destinations, weighted redirects and a scoped API.';

/**
 * Indexing is opt-out **per route**, not site-wide.
 *
 * The root layout used to declare `index: false`, which silently made the
 * public landing page, the privacy page and the terms page invisible to search
 * engines. Private routes now declare their own `robots` metadata instead.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s — go.'
  },
  description: DESCRIPTION,
  applicationName: 'go.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'go.',
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' }
  },
  formatDetection: { telephone: false, address: false, email: false }
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' }
  ],
  colorScheme: 'light dark'
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser().catch(() => null);
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <AppShell email={user?.email ?? null}>{children}</AppShell>
      </body>
    </html>
  );
}
