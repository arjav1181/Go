-- P1: tags and folders for organizing links.
-- Deleting a tag/folder detaches it from links; links are never deleted.

-- Tags -------------------------------------------------------------------
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint tags_name_format check (name ~ '^[a-z0-9][a-z0-9 _-]{0,31}$')
);

-- Names are unique per owner so multiple allowlisted owners do not collide.
-- coalesce(...) is required: NULLs are distinct in a plain unique index, so
-- rows created before an owner id was recorded would never conflict.
create unique index if not exists tags_owner_name_uidx
  on public.tags (coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid), name);
create index if not exists tags_created_by_idx on public.tags (created_by);

-- Folders (single-parent, nestable via parent_id) -------------------------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.folders (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint folders_name_format check (name ~ '^[a-z0-9][a-z0-9 _-]{0,63}$')
);

create unique index if not exists folders_owner_name_uidx
  on public.folders (coalesce(created_by, '00000000-0000-0000-0000-000000000000'::uuid), name);
create index if not exists folders_parent_idx on public.folders (parent_id);
create index if not exists folders_created_by_idx on public.folders (created_by);

-- Join tables: detach on delete (links survive) ---------------------------
create table if not exists public.link_tags (
  link_id uuid not null references public.links (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (link_id, tag_id)
);

create index if not exists link_tags_tag_idx on public.link_tags (tag_id);

create table if not exists public.link_folders (
  link_id uuid not null references public.links (id) on delete cascade,
  folder_id uuid not null references public.folders (id) on delete cascade,
  primary key (link_id, folder_id)
);

create index if not exists link_folders_folder_idx on public.link_folders (folder_id);

-- Row level security: no public access; service role bypasses RLS.
alter table public.tags enable row level security;
alter table public.folders enable row level security;
alter table public.link_tags enable row level security;
alter table public.link_folders enable row level security;