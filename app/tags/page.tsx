import { requireOwner } from '@/lib/auth/owner';
import { listTags, listFolders } from '@/lib/tags/repo';
import { createTagAction, createFolderAction, deleteTagAction, deleteFolderAction } from '@/app/actions/tags';
import { CreateLabelForm } from '@/components/create-label-form';
import { DeleteLabelButton } from '@/components/delete-label-button';

export const metadata = {
  title: 'Tags & folders',
  // Private: owner-only page. Never indexed, never followed.
  robots: { index: false, follow: false, nocache: true }
};

export default async function TagsPage() {
  const owner = await requireOwner();
  const [tags, folders] = await Promise.all([listTags(owner.id), listFolders(owner.id)]);

  const folderNameById = new Map(folders.map((folder) => [folder.id, folder.name]));
  const childCount = new Map<string, number>();
  for (const folder of folders) {
    if (folder.parent_id) {
      childCount.set(folder.parent_id, (childCount.get(folder.parent_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tags &amp; folders</h1>
        <p className="text-sm text-[var(--muted)]">
          Organise links by tag (cross-cutting labels) and folder (a single grouping). Deleting a tag or
          folder never deletes links — it only removes the assignment.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Tags</h2>
        <CreateLabelForm action={createTagAction} label="Tag" placeholder="work" />
        {tags.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No tags yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1 text-sm"
              >
                #{tag.name}
                <DeleteLabelButton
                  label={`Delete tag ${tag.name}`}
                  action={deleteTagAction.bind(null, tag.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Folders</h2>
        <CreateLabelForm action={createFolderAction} label="Folder" placeholder="projects" />
        {folders.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No folders yet.</p>
        ) : (
          <ul className="space-y-2">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span>
                  {folder.parent_id ? (
                    <span className="text-[var(--muted)]">
                      {folderNameById.get(folder.parent_id) ?? 'Unknown'} /{' '}
                    </span>
                  ) : null}
                  <span className="font-medium">{folder.name}</span>
                  {folder.parent_id && (childCount.get(folder.id) ?? 0) > 0 ? (
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      {childCount.get(folder.id)} nested
                    </span>
                  ) : null}
                </span>
                <DeleteLabelButton
                  label={`Delete folder ${folder.name}`}
                  action={deleteFolderAction.bind(null, folder.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}