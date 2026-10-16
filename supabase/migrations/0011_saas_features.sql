-- 0011_saas_features.sql
--
-- Moves go. from "a working shortener" toward "a product": link-in-bio pages,
-- password-protected links, reusable presets, campaign markers and a branded
-- 404. Everything is additive; nothing here changes existing redirect behaviour
-- except when a new column is explicitly set.
--
-- Design notes:
--
--   * Passwords are stored as a salted hash, never plaintext. The redirect
--     route never renders the destination before the password is supplied, so
--     a wrong guess leaks nothing.
--   * Bio pages are public and read through the service role, but they only
--     ever expose links an owner has explicitly flagged `show_on_bio`. They
--     never expose notes, API keys, or internal ids.
--   * `handle` is the public identifier and is globally unique so /@handle
--     cannot be ambiguous between owners.

-- ---------------------------------------------------------------------------
-- Link passwords
-- ---------------------------------------------------------------------------

alter table public.links
  add column if not exists password_hash text;

comment on column public.links.password_hash is
  'Salted hash of the link password. NULL means the link is not protected. '
  'The plaintext is never stored and never logged.';

-- ---------------------------------------------------------------------------
-- Bio / link-in-bio pages
-- ---------------------------------------------------------------------------

create table if not exists public.bio_pages (
  id uuid primary key default gen_random_uuid(),
  handle text not null,
  display_name text not null,
  bio text not null default '',
  avatar_url text not null default '',
  theme text not null default 'minimal',
  accent_color text not null default '#0070f3',
  is_published boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint bio_pages_handle_format check (handle ~ '^[a-z0-9_-]{3,32}$'),
  constraint bio_pages_handle_not_reserved check (
    handle <> 'api' and handle <> 'login' and handle <> 'dashboard'
    and handle <> 'settings' and handle <> 'privacy' and handle <> 'terms'
    and handle <> 'docs' and handle <> 'admin' and handle <> 'logout'
    and handle <> 'auth' and handle <> 'links' and handle <> 'tags'
  ),
  constraint bio_pages_theme_valid check (theme in ('minimal', 'card', 'grid')),
  -- Only #rgb or #rrggbb. Prevents a style injection vector via the accent.
  constraint bio_pages_accent_valid check (accent_color ~ '^#[0-9a-fA-F]{6}$')
);

create unique index if not exists bio_pages_handle_uidx on public.bio_pages (handle);
create index if not exists bio_pages_owner_idx on public.bio_pages (created_by);
create index if not exists bio_pages_published_idx
  on public.bio_pages (created_by, is_published);

alter table public.bio_pages enable row level security;

create trigger bio_pages_set_updated_at
  before update on public.bio_pages
  for each row execute function public.set_updated_at();

-- Links opt in to appearing on a bio page. Default false: a link published for
-- a campaign should not silently appear on a public page.
alter table public.links
  add column if not exists show_on_bio boolean not null default false,
  add column if not exists bio_order integer;

create index if not exists links_bio_idx
  on public.links (created_by, show_on_bio, bio_order);

-- ---------------------------------------------------------------------------
-- Reusable link presets
-- ---------------------------------------------------------------------------

create table if not exists public.link_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  destination_template text not null,
  title_template text not null default '',
  defaults_tag text not null default '',
  is_active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint link_presets_name_format check (name ~ '^[\w .-]{1,64}$'),
  -- Templates are substituted with a slug; refuse anything that could produce
  -- a non-http scheme even after substitution.
  constraint link_presets_destination_format
    check (destination_template ~ '^https?://')
);

create index if not exists link_presets_owner_idx
  on public.link_presets (created_by, is_active);

alter table public.link_presets enable row level security;

create trigger link_presets_set_updated_at
  before update on public.link_presets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Campaign markers
-- ---------------------------------------------------------------------------

-- A short, human-typed campaign label. Kept short and restricted because it
-- lands in analytics grouping and is surfaced on public bio pages.
alter table public.links
  add column if not exists campaign text;

alter table public.links
  add constraint links_campaign_format
  check (campaign is null or campaign ~ '^[a-z0-9_-]{1,32}$');

alter table public.daily_click_stats
  add column if not exists campaign text not null default '';

-- The aggregation grain gains a campaign dimension. Dropped and rebuilt rather
-- than altered because Postgres cannot drop a constraint that backs an
-- on-conflict target.
alter table public.daily_click_stats
  drop constraint if exists daily_click_stats_unique;

alter table public.daily_click_stats
  add constraint daily_click_stats_unique
  unique (link_id, day, referrer_host, device_category, variant_label, campaign);

create index if not exists daily_click_stats_campaign_idx
  on public.daily_click_stats (campaign, day);

create index if not exists links_campaign_idx
  on public.links (created_by, campaign);

-- ---------------------------------------------------------------------------
-- Branded 404
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- increment_click gains a campaign dimension
-- ---------------------------------------------------------------------------

-- Drop the five-argument version before recreating. Leaving both in place makes
-- PostgREST's overload resolution ambiguous when every parameter after the link
-- id has a default.
drop function if exists public.increment_click(uuid, date, text, text, text);

-- The conflict target includes campaign so two campaigns on the same link
-- aggregate separately. A label is truncated rather than rejected: it is an
-- aggregation dimension, and a 33rd character should not lose the click.
create or replace function public.increment_click(
  p_link_id uuid,
  p_day date,
  p_referrer_host text,
  p_device_category text,
  p_variant_label text default '',
  p_campaign text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign text := left(coalesce(p_campaign, ''), 32);
begin
  -- Defence in depth: the caller already filters this, but the function is
  -- SECURITY DEFINER and could be reached from anywhere holding execute.
  if v_campaign <> '' and v_campaign !~ '^[a-z0-9_-]{1,32}$' then
    v_campaign := '';
  end if;

  insert into public.daily_click_stats (
    link_id, day, referrer_host, device_category, variant_label, campaign, click_count
  )
  values (
    p_link_id, p_day, p_referrer_host, p_device_category,
    coalesce(p_variant_label, ''), v_campaign, 1
  )
  on conflict (link_id, day, referrer_host, device_category, variant_label, campaign)
  do update set
    click_count = public.daily_click_stats.click_count + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_click(uuid, date, text, text, text, text) from public;
grant execute on function public.increment_click(uuid, date, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Branded 404
-- ---------------------------------------------------------------------------

alter table public.owner_settings
  add column if not exists custom_404_enabled boolean not null default false,
  add column if not exists custom_404_title text not null default '',
  add column if not exists custom_404_body text not null default '',
  add column if not exists custom_404_link text not null default '';

alter table public.owner_settings
  add constraint owner_settings_404_title_len
    check (char_length(custom_404_title) <= 120),
  add constraint owner_settings_404_body_len
    check (char_length(custom_404_body) <= 500),
  add constraint owner_settings_404_link_len
    check (char_length(custom_404_link) <= 200);

-- ---------------------------------------------------------------------------
-- Bulk operations support
-- ---------------------------------------------------------------------------

-- Batch id lets an import report partial success per row instead of failing the
-- whole file because one slug collided.
create table if not exists public.link_imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null default '',
  total_rows integer not null default 0,
  created_rows integer not null default 0,
  skipped_rows integer not null default 0,
  failed_rows integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists link_imports_owner_idx
  on public.link_imports (created_by, created_at desc);

alter table public.link_imports enable row level security;