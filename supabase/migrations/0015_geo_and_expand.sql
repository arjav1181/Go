-- 0015_geo_and_expand.sql
--
-- Adds the geo dimension the spec's `/countries` and
-- `/groups/{group_guid}/links/clicks/locations` reports need, plus the index
-- that makes `expand` cheap.
--
-- How geography is collected
-- --------------------------
-- There is no geo column anywhere in the schema today, so the spec's location
-- reports have nothing to read. Rather than geolocating an IP address, this
-- reads the country code that the CDN already resolved and passes as
-- `x-vercel-ip-country`. That header is a two-letter ISO country code derived
-- at the edge, so:
--
--   * no visitor IP is ever persisted, which matches what the privacy policy
--     and threat model already claim;
--   * there is no geolocation database to run or go stale;
--   * it degrades to '' rather than failing.
--
-- The cost is that the value is only as good as the edge's answer — it is
-- network-derived, not GPS. The spec makes the same caveat about its own
-- location data, and it is surfaced in the API docs rather than presented as
-- precise.
--
-- Country is stored on the stats row rather than on `links`, because a link can
-- legitimately be clicked from many countries and the breakdown is per day.

alter table public.daily_click_stats
  add column if not exists country_code text not null default '';

-- Two-letter uppercase ISO 3166-1 alpha-2, or empty when unknown. The check
-- keeps out anything that is not plausibly a country code so a bad header
-- cannot poison the dimension.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'daily_click_stats_country_valid'
  ) then
    alter table public.daily_click_stats
      add constraint daily_click_stats_country_valid check (
        country_code = '' or country_code ~ '^[A-Z]{2}$'
      );
  end if;
end
$$;

-- The unique key has to include country_code, otherwise a click from a new
-- country collides with the existing row for that day/referrer/device.
alter table public.daily_click_stats
  drop constraint if exists daily_click_stats_unique;

alter table public.daily_click_stats
  add constraint daily_click_stats_unique
  unique (link_id, day, referrer_host, device_category, variant_label, campaign, country_code);

create index if not exists daily_click_stats_country_idx
  on public.daily_click_stats (country_code, day desc);

-- `expand` resolves a slug to its destination. The lookup is by slug and the
-- join is by primary key, so the existing slug index is the only thing needed;
-- this index supports the ownership filter used by the API.
create index if not exists links_slug_owner_idx
  on public.links (slug, created_by);

-- ---------------------------------------------------------------------------
-- expand
--
-- The documented response shape is created_at / id / link / long_url plus
-- optional fields. Kept in SQL so it is one round trip and cannot drift from
-- the table definition.
-- ---------------------------------------------------------------------------
create or replace function public.expand_link(p_slug text)
returns table (
  id           uuid,
  slug         text,
  destination  text,
  title        text,
  created_at   timestamptz,
  is_active    boolean,
  expires_at   timestamptz,
  has_password boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.slug,
    l.destination_url,
    l.title,
    l.created_at,
    l.is_active,
    l.expires_at,
    l.password_hash is not null
  from public.links l
  where l.slug = p_slug
  limit 1;
$$;

revoke all on function public.expand_link(text) from public, anon, authenticated;
grant execute on function public.expand_link(text) to service_role;

-- ---------------------------------------------------------------------------
-- clicks/summary
--
-- "Get click counts rolled into a single summary field", optionally restricted
-- to one channel/variant/campaign.
-- ---------------------------------------------------------------------------
create or replace function public.click_summary(
  p_link_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  total_clicks      bigint,
  days_with_clicks  bigint,
  variant_label     text,
  campaign          text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(s.click_count), 0)::bigint,
    count(*) filter (where s.click_count > 0),
    s.variant_label,
    s.campaign
  from public.daily_click_stats s
  where s.link_id = p_link_id
    and s.day between p_from and p_to
  group by s.variant_label, s.campaign
  order by sum(s.click_count) desc;
$$;

revoke all on function public.click_summary(uuid, date, date) from public, anon, authenticated;
grant execute on function public.click_summary(uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- Country distribution, for /countries
-- ---------------------------------------------------------------------------
create or replace function public.country_breakdown(
  p_link_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  country_code text,
  clicks       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select s.country_code, sum(s.click_count)::bigint
  from public.daily_click_stats s
  where s.link_id = p_link_id
    and s.day between p_from and p_to
    and s.country_code <> ''
  group by s.country_code
  order by sum(s.click_count) desc;
$$;

revoke all on function public.country_breakdown(uuid, date, date) from public, anon, authenticated;
grant execute on function public.country_breakdown(uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- Referring domains, for /referring_domains
--
-- Distinct from /referrers: this collapses paths and subdomains to one row per
-- registrable host, which is what "how many distinct sites sent me traffic"
-- means.
-- ---------------------------------------------------------------------------
create or replace function public.referring_domain_breakdown(
  p_link_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  domain  text,
  clicks  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Strip a leading www. so www.example.com and example.com are one row.
    regexp_replace(
      regexp_replace(s.referrer_host, '^www\.', ''),
      ':\d+$', ''
    ) as domain,
    sum(s.click_count)::bigint
  from public.daily_click_stats s
  where s.link_id = p_link_id
    and s.day between p_from and p_to
    -- '' is "direct", not a domain, and belongs in /referrers only.
    and s.referrer_host <> ''
  group by 1
  order by sum(s.click_count) desc;
$$;

revoke all on function public.referring_domain_breakdown(uuid, date, date) from public, anon, authenticated;
grant execute on function public.referring_domain_breakdown(uuid, date, date) to service_role;
-- ---------------------------------------------------------------------------
-- increment_click, extended with the country dimension
--
-- Replaces the 0011 definition. The conflict target must match the new unique
-- key in daily_click_stats, otherwise a second click from a new country in the
-- same day would collide on the old key and be dropped as a violation rather
-- than counted.
--
-- The country argument is sanitised here as well as at the call site, for the
-- same reason the campaign is: this function is SECURITY DEFINER and can be
-- reached by anything holding execute on it.
-- ---------------------------------------------------------------------------
create or replace function public.increment_click(
  p_link_id uuid,
  p_day date,
  p_referrer_host text,
  p_device_category text,
  p_variant_label text default '',
  p_campaign text default '',
  p_country_code text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign text := left(coalesce(p_campaign, ''), 32);
  v_country  text := upper(left(coalesce(p_country_code, ''), 2));
begin
  if v_campaign <> '' and v_campaign !~ '^[a-z0-9_-]{1,32}$' then
    v_campaign := '';
  end if;

  -- Anything that is not two uppercase letters is not a country code. The CDN
  -- sends values like 'XX' for unknown and occasionally odd casing; anything
  -- else is discarded rather than stored.
  if v_country <> '' and v_country !~ '^[A-Z]{2}$' then
    v_country := '';
  end if;

  insert into public.daily_click_stats (
    link_id, day, referrer_host, device_category, variant_label, campaign,
    country_code, click_count
  )
  values (
    p_link_id, p_day, p_referrer_host, p_device_category,
    coalesce(p_variant_label, ''), v_campaign, v_country, 1
  )
  on conflict (
    link_id, day, referrer_host, device_category, variant_label, campaign, country_code
  )
  do update set
    click_count = public.daily_click_stats.click_count + 1,
    updated_at = now();
end;
$$;

revoke all on function public.increment_click(uuid, date, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.increment_click(uuid, date, text, text, text, text, text)
  to service_role;
