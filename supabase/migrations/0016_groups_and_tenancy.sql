-- 0016_groups_and_tenancy.sql
--
-- Multi-tenancy (spec sheet section 11).
--
-- Up to now every table is owner-scoped: one implicit tenant, keyed on
-- `created_by`, and every query filters on it. That works for a single operator
-- and has no way to express "this team, with these people, these permissions".
--
-- The spec's model:
--
--   Group     an organisational boundary with its own users, links, QR Codes,
--             Pages and custom domains. Up to 150 groups per account.
--   User      a member with a role per group.
--   Role      what a member may do inside a group.
--   SSO       Enterprise-only, and out of scope for the schema.
--
-- Migration strategy — why this is additive
-- -----------------------------------------
-- Every asset table gains a nullable `group_id`. Nullable, because the existing
-- rows have no group and inventing one for them would mean rewriting history;
-- NULL is interpreted as "the owner's default group", resolved at read time.
--
-- Nothing is made NOT NULL here and no column is backfilled, so this migration
-- is safe to apply to a live database with traffic. A later migration can
-- backfill and tighten once the application is demonstrably reading the new
-- column.
--
-- RLS finally becomes real
-- -----------------------
-- Every migration up to here enabled RLS and declared *zero* policies, because
-- all access went through the service role and owner scoping happened in
-- application code. That remains true for these tables — the service role
-- bypasses RLS, and the request paths still filter explicitly.
--
-- Policies are added here only for the tenancy tables themselves, where a
-- *client* (a signed-in browser session) genuinely needs to read its own
-- membership to render a group switcher. That is the first place in the schema
-- where a non-service-role reader exists, so it is the first place where a
-- policy is the right tool. The `auth` schema is referenced by these policies
-- only — and unlike migration 0012, which referenced it from a *constraint*,
-- that does not prevent this file applying to a plain Postgres, because the
-- policies are added conditionally below.

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
create table if not exists public.groups (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null,
  name         text not null,
  slug         text not null,
  description  text not null default '',
  -- Plan-gated in the spec (Enterprise). Kept as a plain flag so the gate can
  -- be enforced by the plan layer without a schema change.
  sso_required boolean not null default false,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint groups_name_length check (char_length(name) between 1 and 80),
  constraint groups_slug_format check (slug ~ '^[a-z0-9_-]{3,64}$')
);

-- Slug is unique across the whole install, not per owner: a group slug appears
-- in URLs, so two owners both being able to claim 'marketing' would make
-- routing ambiguous.
create unique index if not exists groups_slug_uidx on public.groups (slug);

create index if not exists groups_owner_idx on public.groups (created_by, archived);

-- Spec: up to 150 groups per Enterprise account.
create or replace function public.enforce_group_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing integer;
begin
  if new.archived then
    return new;
  end if;

  select count(*) into existing
  from public.groups
  where created_by = new.created_by and not archived and id <> new.id;

  if existing >= 150 then
    raise exception 'GROUP_LIMIT_EXCEEDED'
      using hint = 'An account may have at most 150 active groups.';
  end if;

  return new;
end;
$$;

drop trigger if exists groups_enforce_limit on public.groups;
create trigger groups_enforce_limit
  before insert or update on public.groups
  for each row execute function public.enforce_group_limit();

-- ---------------------------------------------------------------------------
-- Memberships and roles
--
-- Roles are deliberately coarse. The spec defers the detailed matrix to the
-- subscription and account setup, so inventing a fine-grained one here would
-- be guessing at a contract we have not agreed.
--
--   owner    full control, including deleting the group and managing members
--   admin    manage assets and members, but not delete the group
--   editor   create and edit assets, no member management
--   viewer   read-only
-- ---------------------------------------------------------------------------
create table if not exists public.group_members (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  -- The owner's uuid, matching every other created_by in this schema.
  user_id     uuid not null,
  role        text not null default 'viewer',
  invited_by  uuid,
  created_at  timestamptz not null default now(),

  constraint group_members_role_valid
    check (role in ('owner', 'admin', 'editor', 'viewer')),
  -- One row per user per group: without this a user could hold two conflicting
  -- roles in the same group and every permission check would have to guess.
  constraint group_members_unique unique (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

create or replace function public.touch_groups_updated_at()
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

drop trigger if exists groups_touch_updated_at on public.groups;
create trigger groups_touch_updated_at
  before update on public.groups
  for each row execute function public.touch_groups_updated_at();

-- ---------------------------------------------------------------------------
-- Asset scoping
--
-- Nullable on purpose; see the header. NULL means "the owner's default group".
-- ---------------------------------------------------------------------------
alter table public.links       add column if not exists group_id uuid references public.groups (id) on delete set null;
alter table public.qr_codes    add column if not exists group_id uuid references public.groups (id) on delete set null;
alter table public.bio_pages   add column if not exists group_id uuid references public.groups (id) on delete set null;
alter table public.campaigns   add column if not exists group_id uuid references public.groups (id) on delete set null;
alter table public.api_keys    add column if not exists group_id uuid references public.groups (id) on delete set null;

-- Partial indexes: most rows in a single-owner deployment will stay NULL, and
-- an index on a mostly-NULL column is mostly dead weight.
create index if not exists links_group_idx     on public.links (group_id)     where group_id is not null;
create index if not exists qr_codes_group_idx  on public.qr_codes (group_id) where group_id is not null;
create index if not exists bio_pages_group_idx on public.bio_pages (group_id) where group_id is not null;
create index if not exists campaigns_group_idx on public.campaigns (group_id) where group_id is not null;

-- ---------------------------------------------------------------------------
-- Permission helpers
--
-- One place that decides "may this user do this", so the UI, the API and the
-- server actions cannot drift. SECURITY DEFINER because it reads
-- group_members, which the caller's role may not otherwise be able to select.
-- ---------------------------------------------------------------------------
create or replace function public.group_role_of(p_group_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.group_members
  where group_id = p_group_id and user_id = p_user_id
  limit 1;
$$;

create or replace function public.user_can(
  p_group_id uuid,
  p_user_id  uuid,
  p_action   text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with r as (
    select public.group_role_of(p_group_id, p_user_id) as role
  )
  select case
    -- Unauthenticated or not a member: nothing.
    when r.role is null then false
    -- Delete is reserved for the group owner.
    when p_action = 'delete' then r.role = 'owner'
    when p_action = 'manage_members' then r.role in ('owner', 'admin')
    when p_action = 'write' then r.role in ('owner', 'admin', 'editor')
    when p_action = 'read' then true
    else false
  end
  from r;
$$;

-- A member of a group is a member of every group the same user owns, so the
-- switcher can list them in one call.
create or replace function public.groups_for_user(p_user_id uuid)
returns table (
  id          uuid,
  name        text,
  slug        text,
  role        text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.name, g.slug, m.role
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.user_id = p_user_id and not g.archived
  order by g.name;
$$;

revoke all on function public.group_role_of(uuid, uuid) from public, anon, authenticated;
grant execute on function public.group_role_of(uuid, uuid) to service_role, authenticated;
revoke all on function public.user_can(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.user_can(uuid, uuid, text) to service_role, authenticated;
revoke all on function public.groups_for_user(uuid) from public, anon, authenticated;
grant execute on function public.groups_for_user(uuid) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Enabled everywhere, policies only where a client genuinely needs to read.
-- ---------------------------------------------------------------------------
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

do $$
begin
  -- The `auth` schema only exists on Supabase. Guarded so this migration still
  -- applies to a plain Postgres — which is what the docker compose db service
  -- and `npm run db:migrate` both run against.
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    execute $p$
      create policy "groups visible to members"
        on public.groups for select
        using (
          exists (
            select 1 from public.group_members m
            where m.group_id = groups.id and m.user_id = auth.uid()
          )
        );
    $p$;

    execute $p$
      create policy "own memberships visible"
        on public.group_members for select
        using (user_id = auth.uid());
    $p$;
  end if;
end
$$;