import { requireOwner } from '@/lib/auth/owner';
import { createLink } from '@/app/actions/links';
import { listTags, listFolders } from '@/lib/tags/repo';
import LinkForm from '@/components/link-form';

export const metadata = {
  title: 'New link',
  // Private: owner-only page. Never indexed, never followed.
  robots: { index: false, follow: false, nocache: true }
};


export default async function NewLinkPage() {
  const owner = await requireOwner();
  const [tags, folders] = await Promise.all([listTags(owner.id), listFolders(owner.id)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New link</h1>
        <p className="text-sm text-[var(--muted)]">Create a short link with optional custom slug.</p>
      </div>
      <LinkForm
        action={createLink}
        submitLabel="Create link"
        availableTags={tags.map((tag) => ({ id: tag.id, name: tag.name }))}
        availableFolders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
      />
    </div>
  );
}