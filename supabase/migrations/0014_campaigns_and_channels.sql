-- 0014_campaigns_and_channels.sql
--
-- Campaigns and channels (spec sheet section 08).
--
-- What exists today is a flat `links.campaign` label — one free-text string per
-- link, used to group clicks. That is enough to answer "how many clicks did my
-- email links get" but not "which distribution channel within that campaign is
-- performing", which is what the spec describes.
--
-- The documented model is:
--
--   Campaign  has a name and at least one Channel.
--   Channel   is a distribution source: email, social, announcements, etc.
--
-- with documented limits of 100 channels per campaign and 500 channels per
-- account, and a documented UTM convention:
--
--   channel name -> utm_source
--   campaign name -> utm_campaign
--   utm_medium    -> always "go"
--
-- Two design notes
-- ----------------
-- The flat `links.campaign` column is kept. It is what `recordClick` validates
-- and what the existing analytics cube aggregates on, so removing it would mean
-- rewriting the redirect path and the analytics panel for no user-visible gain.
-- `links.campaign_id` is the structured pointer; when it is null the old label
-- still works exactly as before. Existing links are unaffected.
--
-- Channel limits are enforced with triggers rather than left to the application.
-- The spec states them as hard limits, and a trigger is the only place that
-- still holds when a second writer, a script or the API adds a row.

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null,
  name        text not null,
  description text not null default '',
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint campaigns_name_length check (char_length(name) between 1 and 80)
);

create index if not exists campaigns_owner_idx on public.campaigns (created_by, archived);

-- One live campaign per name per owner. Reusing a name would make the UTM
-- utm_campaign value ambiguous.
create unique index if not exists campaigns_owner_name_uidx
  on public.campaigns (created_by, lower(name))
  where not archived;

-- ---------------------------------------------------------------------------
-- Channels
-- ---------------------------------------------------------------------------
create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  created_by  uuid not null,
  name        text not null,
  -- The spec's documented default for campaign-channel links.
  utm_medium  text not null default 'go',
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),

  constraint channels_name_length check (char_length(name) between 1 and 80),
  constraint channels_utm_medium_length check (char_length(utm_medium) between 1 and 80)
);

create index if not exists channels_campaign_idx on public.channels (campaign_id, archived);

create unique index if not exists channels_campaign_name_uidx
  on public.channels (campaign_id, lower(name))
  where not archived;

-- ---------------------------------------------------------------------------
-- Link attribution
-- ---------------------------------------------------------------------------
alter table public.links
  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null,
  add column if not exists channel_id  uuid references public.channels  (id) on delete set null;

create index if not exists links_campaign_id_idx on public.links (campaign_id) where campaign_id is not null;
create index if not exists links_channel_id_idx  on public.links (channel_id)  where channel_id is not null;

-- ---------------------------------------------------------------------------
-- Documented channel limits, enforced in the database
-- ---------------------------------------------------------------------------
create or replace function public.enforce_channel_limits()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  per_campaign integer;
  per_account  integer;
begin
  if new.archived then
    return new;
  end if;

  select count(*) into per_campaign
  from public.channels
  where campaign_id = new.campaign_id and not archived and id <> new.id;

  -- Spec: up to 100 channels per campaign.
  if per_campaign >= 100 then
    raise exception 'CHANNEL_LIMIT_PER_CAMPAIGN'
      using hint = 'A campaign may have at most 100 active channels.';
  end if;

  select count(*) into per_account
  from public.channels c
  join public.campaigns k on k.id = c.campaign_id
  where c.created_by = new.created_by and not c.archived and not k.archived and c.id <> new.id;

  -- Spec: up to 500 channels per account/group.
  if per_account >= 500 then
    raise exception 'CHANNEL_LIMIT_PER_ACCOUNT'
      using hint = 'An account may have at most 500 active channels.';
  end if;

  return new;
end;
$$;

drop trigger if exists channels_enforce_limits on public.channels;
create trigger channels_enforce_limits
  before insert or update on public.channels
  for each row execute function public.enforce_channel_limits();

-- A campaign must always have at least one channel, per the spec. Enforced on
-- archive too, so the last channel cannot be removed by archiving its parent.
create or replace function public.enforce_campaign_has_channel()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.archived and not exists (
    select 1 from public.channels
    where campaign_id = new.id and not archived
  ) then
    raise exception 'CAMPAIGN_REQUIRES_CHANNEL'
      using hint = 'A campaign must contain at least one channel.';
  end if;
  return new;
end;
$$;

drop trigger if exists campaigns_require_channel on public.campaigns;
create trigger campaigns_require_channel
  before update on public.campaigns
  for each row execute function public.enforce_campaign_has_channel();

-- The rule is "a campaign must contain at least one channel", and the trigger
-- above only covers one direction of the violation: archiving the campaign.
-- Without this one, archiving a campaign's last channel would leave a live
-- campaign with zero channels, which is exactly the state the spec forbids.
create or replace function public.enforce_channel_not_orphaned()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  campaign_archived boolean;
begin
  -- Fires when the row is actually leaving the campaign's active set: either it
  -- is being archived, or it is being deleted outright. Note the direction —
  -- an earlier version of this guard tested for `new.archived = false` and so
  -- never fired on the archive it was written to catch, which the test below
  -- is what exposed.
  if new.archived = true or tg_op = 'DELETE' then
    select c.archived into campaign_archived
    from public.campaigns c
    where c.id = old.campaign_id;

    if campaign_archived = false and not exists (
      select 1 from public.channels
      where campaign_id = old.campaign_id and not archived and id <> old.id
    ) then
      raise exception 'CAMPAIGN_REQUIRES_CHANNEL'
        using hint = 'A campaign must contain at least one channel. Archive the campaign first.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists channels_not_orphaned on public.channels;
create trigger channels_not_orphaned
  before update or delete on public.channels
  for each row execute function public.enforce_channel_not_orphaned();

-- Percent-encode a value destined for a query string.
--
-- `encode` takes bytea, not text, so the cast is required. The whitespace
-- substitution is what makes this correct for URLs specifically: generic
-- form encoding turns a space into '+', which inside a query string means a
-- literal plus rather than a space, so a campaign called "spring sale" would
-- otherwise arrive at the destination as "spring+sale".
create or replace function public.utm_encode(value text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  result text := '';
  ch     text;
  hexed  text;
  i      integer;
begin
  if value is null then
    return null;
  end if;

  -- Only RFC 3986 unreserved characters pass through. Postgres' built-in
  -- `escape` encoding was tried first and is not usable here: verified by
  -- running it, it leaves every one of  !\"#$%&()+,-./:;<=>?@[]^_`{|}~  alone,
  -- so an unescaped & or = inside a UTM value would split the query string.
  for ch in select regexp_split_to_table(btrim(value), '') loop
    if ch ~ '^[A-Za-z0-9._~-]$' then
      result := result || ch;
    else
      -- Multi-byte characters are percent-encoded byte by byte, so a non-ASCII
      -- campaign name produces a valid URL rather than mojibake.
      hexed := encode(convert_to(ch, 'UTF8'), 'hex');
      for i in 0..(length(hexed) / 2 - 1) loop
        result := result || '%' || upper(substr(hexed, i * 2 + 1, 2));
      end loop;
    end if;
  end loop;

  return result;
end;
$$;

revoke all on function public.utm_encode(text) from public, anon, authenticated;
grant execute on function public.utm_encode(text) to service_role;

-- ---------------------------------------------------------------------------
-- UTM builder
--
-- One function so the web UI and the API cannot drift, and so the encoding lives
-- in one tested place. Existing destination parameters are preserved and an
-- incoming parameter of the same name is replaced, which is what an owner
-- re-tagging a link would expect.
-- ---------------------------------------------------------------------------
create or replace function public.build_campaign_url(
  p_destination text,
  p_campaign    text,
  p_channel     text,
  p_medium      text default 'go'
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  result text;
  sep    text;
begin
  if p_destination is null or btrim(p_destination) = '' then
    return p_destination;
  end if;

  result := p_destination;

  foreach sep in array array['utm_campaign', 'utm_medium', 'utm_source'] loop
    -- Drop any existing value for this parameter, keeping the rest of the
    -- query intact. The capture group keeps the leading ? or & so separators
    -- do not shift.
    result := regexp_replace(result, '([?&])' || sep || '=[^&#]*', '\1', 'g');
  end loop;

  -- Collapse the artefacts left behind by those removals. Rewriting
  -- ".../p?utm_source=old&keep=1" leaves ".../p?&keep=1", which parses but is
  -- not what anyone meant.
  -- Collapse doubled separators such as "?&" left by the removals above. The
  -- second separator is matched as a class, not as a backreference: a
  -- backreference would demand the *same* character twice and so never match
  -- "?&" at all.
  result := regexp_replace(result, '([?&])[?&]', '\1', 'g');
  result := regexp_replace(result, '[?&]+$', '', 'g');

  if nullif(btrim(p_campaign), '') is not null then
    result := result
      || case when result like '%?%' then '&' else '?' end
      || 'utm_campaign=' || public.utm_encode(p_campaign);
  end if;

  if nullif(btrim(p_medium), '') is not null then
    result := result
      || case when result like '%?%' then '&' else '?' end
      || 'utm_medium=' || public.utm_encode(p_medium);
  end if;

  if nullif(btrim(p_channel), '') is not null then
    result := result
      || case when result like '%?%' then '&' else '?' end
      || 'utm_source=' || public.utm_encode(p_channel);
  end if;

  return result;
end;
$$;

revoke all on function public.build_campaign_url(text, text, text, text) from public, anon, authenticated;
grant execute on function public.build_campaign_url(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Channel comparison report
--
-- The spec asks for side-by-side channel performance with a time series per
-- channel. Returns one row per channel per day so the client can pivot it.
-- ---------------------------------------------------------------------------
create or replace function public.channel_engagement(
  p_campaign_id uuid,
  p_from        date,
  p_to          date
)
returns table (
  channel_id   uuid,
  channel_name text,
  day          date,
  link_count   bigint,
  clicks       bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ch.id,
    ch.name,
    s.day,
    count(distinct l.id),
    coalesce(sum(s.click_count), 0)::bigint
  from public.channels ch
  join public.links l on l.channel_id = ch.id
  join public.daily_click_stats s on s.link_id = l.id
  where l.campaign_id = p_campaign_id
    and s.day between p_from and p_to
  group by ch.id, ch.name, s.day
  order by ch.name, s.day;
$$;

revoke all on function public.channel_engagement(uuid, date, date) from public, anon, authenticated;
grant execute on function public.channel_engagement(uuid, date, date) to service_role;

-- ---------------------------------------------------------------------------
-- RLS + updated_at
-- ---------------------------------------------------------------------------
alter table public.campaigns enable row level security;
alter table public.channels  enable row level security;

create or replace function public.touch_campaigns_updated_at()
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

drop trigger if exists campaigns_touch_updated_at on public.campaigns;
create trigger campaigns_touch_updated_at
  before update on public.campaigns
  for each row execute function public.touch_campaigns_updated_at();