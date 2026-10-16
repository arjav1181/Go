-- 0013_pages_and_blocks.sql
--
-- Bitly Pages (spec sheet section 07) generalised into a block editor.
--
-- Strategy
-- --------
-- 0011 shipped `bio_pages` as a fixed layout: display_name, bio, avatar_url,
-- theme, accent_color. That is one render of one template, and it is live on
-- production, so this migration extends the table rather than replacing it.
-- Every existing column keeps working and keeps its meaning; the block editor
-- is an alternative rendering of the same row.
--
-- Draft vs published
-- -----------------
-- The spec is explicit: "Page changes persist as a draft; public changes do not
-- go live until 'Publish changes' is selected", and "leaving the editor does
-- not discard the draft". That needs two columns, not one — a single `blocks`
-- column would publish on every keystroke. So `draft_blocks` is the working
-- copy and `published_blocks` is what the public route renders.
--
-- Why jsonb rather than a blocks table
-- ------------------------------------
-- Blocks are ordered, reordered, pinned and scheduled as a unit, and are read
-- and written together as one document. A normalised `page_blocks` table would
-- turn every drag-and-drop reorder into a transaction that deletes and reinserts
-- every row. A jsonb array keeps a reorder to a single UPDATE. Per-block click
-- analytics still work because each block carries its own stable uuid in
-- `block_id`, which is what `page_block_daily_stats` aggregates on.
--
-- Scheduling is per block (`schedule_from` / `schedule_until`) and per page
-- (`scheduled_publish_at` / `scheduled_unpublish_at`), matching the spec's
-- "scheduled to appear and/or unpublish at a selected date/time". A block that
-- is scheduled out is simply omitted from the public render — it is not
-- deleted, so it comes back when the window reopens.

-- ---------------------------------------------------------------------------
-- Page identity and lifecycle
-- ---------------------------------------------------------------------------
alter table public.bio_pages
  -- 'bio' keeps the existing /@handle behaviour; 'page' is a general landing
  -- page claimed at its own path.
  add column if not exists kind text not null default 'bio',

  -- Public path for kind = 'page'. NULL for bio pages, which use the handle.
  add column if not exists slug text,

  -- The working copy. Everything the editor writes lands here first.
  add column if not exists draft_blocks jsonb not null default '[]'::jsonb,

  -- What the public route renders. NULL means "publish has never happened",
  -- in which case the public route falls back to the legacy fixed layout so
  -- existing pages never go blank after deploy.
  add column if not exists published_blocks jsonb,

  -- Page-level scheduling.
  add column if not exists scheduled_publish_at   timestamptz,
  add column if not exists scheduled_unpublish_at timestamptz,

  -- Scheduling a future publish also flips is_published, so every existing
  -- code path that checks is_published keeps honouring it.
  add column if not exists published_at timestamptz,

  add column if not exists seo_title       text not null default '',
  add column if not exists seo_description text not null default '',

  -- Spec: "theme/layout choices and profile/background imagery".
  add column if not exists background_url  text not null default '',
  add column if not exists background_blur  boolean not null default false,

  -- Contacts block (spec section 07, "digital business card").
  add column if not exists contact_name  text not null default '',
  add column if not exists contact_email text not null default '',
  add column if not exists contact_phone text not null default '';

-- Postgres has no `add constraint if not exists`, so guard on pg_constraint.
-- Without this a re-run aborts, which matters because the whole file is
-- written to be replayable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bio_pages_kind_valid'
  ) then
    alter table public.bio_pages
      add constraint bio_pages_kind_valid check (kind in ('bio', 'page'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bio_pages_slug_valid'
  ) then
    alter table public.bio_pages
      add constraint bio_pages_slug_valid check (
        slug is null or slug ~ '^[a-z0-9_-]{3,64}$'
      );
  end if;
end
$$;

-- At most one live claim per public path. Partial, so a bio page (NULL slug)
-- and an unscheduled page never collide.
create unique index if not exists bio_pages_slug_uidx
  on public.bio_pages (slug)
  where slug is not null and kind = 'page';

create index if not exists bio_pages_publish_schedule_idx
  on public.bio_pages (scheduled_publish_at, scheduled_unpublish_at)
  where scheduled_publish_at is not null or scheduled_unpublish_at is not null;

-- ---------------------------------------------------------------------------
-- Page analytics
--
-- Views are page-level; clicks are per block, so a link-in-bio page can report
-- both totals and a click-through rate. The spec treats contact downloads as
-- their own measurable event, which is a contact block click and needs no
-- separate table.
-- ---------------------------------------------------------------------------
create table if not exists public.page_daily_stats (
  page_id  uuid not null references public.bio_pages (id) on delete cascade,
  day      date not null,
  views    bigint not null default 0,
  primary key (page_id, day)
);

create table if not exists public.page_block_daily_stats (
  page_id  uuid not null references public.bio_pages (id) on delete cascade,
  block_id uuid not null,
  day      date not null,
  clicks   bigint not null default 0,
  primary key (page_id, block_id, day),
  -- A block only ever belongs to one page, so this cannot cross pages.
  foreign key (page_id) references public.bio_pages (id) on delete cascade
);

create index if not exists page_block_daily_stats_day_idx
  on public.page_block_daily_stats (day desc);

create or replace function public.increment_page_view(
  p_page_id uuid,
  p_day     date
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.page_daily_stats (page_id, day, views)
  values (p_page_id, p_day, 1)
  on conflict (page_id, day) do update set views = page_daily_stats.views + 1
  returning views;
$$;

create or replace function public.increment_block_click(
  p_page_id uuid,
  p_block_id uuid,
  p_day     date
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.page_block_daily_stats (page_id, block_id, day, clicks)
  values (p_page_id, p_block_id, p_day, 1)
  on conflict (page_id, block_id, day)
    do update set clicks = page_block_daily_stats.clicks + 1
  returning clicks;
$$;

revoke all on function public.increment_page_view(uuid, date) from public, anon, authenticated;
grant execute on function public.increment_page_view(uuid, date) to service_role;
revoke all on function public.increment_block_click(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.increment_block_click(uuid, uuid, date) to service_role;

alter table public.page_daily_stats       enable row level security;
alter table public.page_block_daily_stats enable row level security;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_bio_pages_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bio_pages_touch_updated_at on public.bio_pages;
create trigger bio_pages_touch_updated_at
  before update on public.bio_pages
  for each row execute function public.touch_bio_pages_updated_at();