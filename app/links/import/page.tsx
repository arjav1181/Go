import Link from 'next/link';
import { BulkManager } from '@/components/bulk-manager';

export const metadata = {
  title: 'Bulk import and export',
  // Private: owner-only page. Never indexed, never followed.
  robots: { index: false, follow: false, nocache: true }
};

export default function BulkPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <Link
        href="/dashboard"
        className="text-label-13 text-tertiary transition-colors hover:text-primary"
      >
        ← Links
      </Link>
      <h1 className="mt-3 text-heading-24 text-primary">Bulk management</h1>
      <p className="mt-1.5 text-copy-13 text-secondary">
        Create many links at once, or take a copy of everything you have.
      </p>
      <div className="mt-8">
        <BulkManager />
      </div>
    </div>
  );
}
