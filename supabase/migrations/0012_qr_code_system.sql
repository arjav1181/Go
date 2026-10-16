-- 0012_qr_code_system.sql
--
-- Bitly Codes, modelled on the spec sheet (sections 06 and 16).
--
-- The important design decision here is how scans reach analytics.
--
-- A QR scan has no HTTP referrer — it is optical, so the scanner sends no
-- Referer header. Bitly handles this by attributing scans to a synthetic
-- referrer so they appear in the normal referrer breakdown ("Bitly QR Code"),
-- and does the same for clicks that originate on a published Page
-- ("Bitly Link-in-bio").
--
-- We take the same approach rather than inventing a parallel analytics path:
-- scans for a code attached to a link call increment_click with a reserved
-- referrer host, so they flow into the existing analytics cube, the dashboard,
-- and the API for free. qr_daily_stats only exists for standalone codes, which
-- have no link row to attribute to.
--
-- The reserved referrer strings are enforced as reserved elsewhere; the
-- reserved_prefix set in redirect routing keeps visitor-supplied hosts from
-- colliding with them.

-- ---------------------------------------------------------------------------
-- Managed QR Code resources
-- ---------------------------------------------------------------------------
create table if not exists public.qr_codes (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null,

  -- Display name. Matches Bitly's `title` field on the QR resource.
  title         text not null default '',

  -- 'dynamic' codes are a managed resource whose destination can be changed
  -- after printing. 'static' codes are a one-shot render of raw content with no
  -- stored destination; the image cannot be rewritten after creation.
  kind          text not null default 'dynamic'
                  check (kind in ('dynamic', 'static')),

  -- Dynamic code pointing at a Bitly. When set, scans are attributed to this
  -- link and flow into the shared analytics cube.
  link_id       uuid references public.links (id) on delete cascade,

  -- Dynamic code with a standalone destination and no managed link.
  destination_url text,

  -- Static code raw payload. text/email/wifi/sms/geolocation are supported by
  -- the renderer; anything else is passed through verbatim.
  content       text,

  -- Bitly render_customizations equivalent. Stored as jsonb and validated in
  -- application code (lib/qr/customizations.ts) because the schema is
  -- open-ended and evolves with the design options.
  customizations jsonb not null default '{}'::jsonb,

  archived      boolean not null default false,
  expires_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A code must have exactly one target, matching its kind.
  constraint qr_codes_single_target check (
    num_nonnulls(link_id, destination_url, content) = 1
    and (kind = 'static') = (content is not null)
  )
);

create index if not exists qr_codes_created_by_idx on public.qr_codes (created_by);
create index if not exists qr_codes_link_idx      on public.qr_codes (link_id) where link_id is not null;
create index if not exists qr_codes_active_idx    on public.qr_codes (created_by, archived, created_at desc);

comment on table public.qr_codes is 'Managed QR Code resources (Bitly Codes).';

-- ---------------------------------------------------------------------------
-- Scan analytics for standalone codes
--
-- Only used by codes with no link_id. Codes attached to a link record against
-- the link instead and do not write here.
-- ---------------------------------------------------------------------------
create table if not exists public.qr_daily_stats (
  qr_code_id      uuid not null references public.qr_codes (id) on delete cascade,
  day             date not null,
  referrer_host   text not null default '',
  device_category text not null default '',
  scans           bigint not null default 0,
  primary key (qr_code_id, day, referrer_host, device_category)
);

create index if not exists qr_daily_stats_day_idx on public.qr_daily_stats (day desc);

-- ---------------------------------------------------------------------------
-- Scan counter
-- ---------------------------------------------------------------------------
create or replace function public.increment_qr_scan(
  p_qr_code_id      uuid,
  p_day             date,
  p_referrer_host   text default '',
  p_device_category text default ''
)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.qr_daily_stats as s (qr_code_id, day, referrer_host, device_category, scans)
  values (p_qr_code_id, p_day, left(coalesce(p_referrer_host, ''), 255),
          left(coalesce(p_device_category, ''), 32), 1)
  on conflict (qr_code_id, day, referrer_host, device_category)
    do update set scans = s.scans + 1
  returning scans;
$$;

revoke all on function public.increment_qr_scan(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.increment_qr_scan(uuid, date, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Matches the convention used by every earlier migration: RLS is enabled and no
-- policies are declared, because all reads and writes go through the service
-- role key, which bypasses RLS. Owner scoping is enforced in application code
-- (`lib/auth/owner.ts`) and by `.eq('created_by', owner.id)` on every query.
--
-- Two reasons not to add policies here that reach for `auth.uid()`:
--   1. No earlier migration references the `auth` schema, so adding it here
--      would make this migration the only one that cannot apply to a plain
--      Postgres — which breaks `npm run db:migrate` and the docker compose db
--      service, both of which run without Supabase.
--   2. `links.created_by` is a bare `uuid` for the same reason: the owner id
--      is not guaranteed to be a row in `auth.users`.
--
-- Row-level scoping becomes real when multi-tenancy lands, and that is where
-- policies belong.
-- ---------------------------------------------------------------------------
alter table public.qr_codes       enable row level security;
alter table public.qr_daily_stats enable row level security;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_qr_codes_updated_at()
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

drop trigger if exists qr_codes_touch_updated_at on public.qr_codes;
create trigger qr_codes_touch_updated_at
  before update on public.qr_codes
  for each row execute function public.touch_qr_codes_updated_at();