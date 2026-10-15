-- Links table
create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  destination_url text not null,
  title text,
  notes text,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint links_slug_format check (slug ~ '^[a-z0-9_-]{3,64}$')
);

create unique index if not exists links_slug_uidx on public.links (slug);
create index if not exists links_created_by_idx on public.links (created_by);

-- Aggregate click stats (no per-visitor rows)
create table if not exists public.daily_click_stats (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.links (id) on delete cascade,
  day date not null,
  referrer_host text not null,
  device_category text not null,
  click_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_click_stats_unique unique (link_id, day, referrer_host, device_category)
);

create index if not exists daily_click_stats_link_day_idx on public.daily_click_stats (link_id, day);

-- Atomic increment helper
create or replace function public.increment_click(
  p_link_id uuid,
  p_day date,
  p_referrer_host text,
  p_device_category text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_click_stats (link_id, day, referrer_host, device_category, click_count)
  values (p_link_id, p_day, p_referrer_host, p_device_category, 1)
  on conflict (link_id, day, referrer_host, device_category)
  do update set
    click_count = public.daily_click_stats.click_count + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_click(uuid, date, text, text) from public;
grant execute on function public.increment_click(uuid, date, text, text) to service_role;

-- Row level security: no public access; service role bypasses RLS.
alter table public.links enable row level security;
alter table public.daily_click_stats enable row level security;

-- Keep updated_at fresh on update
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists links_set_updated_at on public.links;
create trigger links_set_updated_at
before update on public.links
for each row execute function public.set_updated_at();

drop trigger if exists daily_click_stats_set_updated_at on public.daily_click_stats;
create trigger daily_click_stats_set_updated_at
before update on public.daily_click_stats
for each row execute function public.set_updated_at();
