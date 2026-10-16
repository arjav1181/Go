-- 0017_custom_domains.sql
--
-- Branded short domains (spec sheet section 10).
--
-- What exists today is `ALIAS_DOMAINS`, an environment variable listing hostnames
-- that are accepted as aliases of the canonical domain. It works, but it is
-- not a product: there is no record of who owns a domain, no verification, and
-- no way to add one without a redeploy.
--
-- The spec describes a four-step flow: enter the domain, select groups,
-- configure DNS, verify. This adds the state that flow needs.
--
-- Verification is by DNS TXT record rather than by a live HTTP probe. A TXT
-- record can be checked without the domain pointing anywhere yet, which means
-- the owner can verify before the cutover is live. The CNAME for traffic is
-- given as an instruction, not applied — this application cannot and should not
-- write to someone's DNS.
--
-- `check_token` is a random value the owner pastes into the TXT record. It is
-- not a secret and is not a credential: it only proves the requester can edit
-- DNS for that zone, which is the whole point of the check.

create table if not exists public.custom_domains (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null,
  group_id    uuid references public.groups (id) on delete set null,

  hostname    text not null,
  -- Spec: "the short-link domain can be no more than 32 characters including
  -- the dot". Enforced so an over-long domain is rejected at insert rather
  -- than producing a URL nobody can read.
  verification_token text not null default '',
  status      text not null default 'pending',
  -- Where the visitor is sent when they enter only the domain root.
  root_redirect_url text not null default '',

  verified_at timestamptz,
  last_checked_at timestamptz,
  failure_reason text not null default '',
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint custom_domains_hostname_length check (char_length(hostname) <= 32),
  constraint custom_domains_status_valid
    check (status in ('pending', 'verified', 'failed', 'disabled'))
);

-- Hostnames are globally unique: two owners claiming the same short domain
-- would make routing ambiguous at exactly the moment it matters.
create unique index if not exists custom_domains_hostname_uidx
  on public.custom_domains (lower(hostname))
  where not archived;

create index if not exists custom_domains_owner_idx
  on public.custom_domains (created_by, archived);

-- ---------------------------------------------------------------------------
-- Root router
--
-- Spec: "send a visitor who enters only the custom domain to a configured
-- page". Kept as a per-domain column rather than a global setting so a group
-- can point its root somewhere different.
--
-- Validated in SQL because it is a redirect target: without this, a typo could
-- store `javascript:...` and it would be served to every visitor who typed the
-- bare domain.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'custom_domains_root_url_valid'
  ) then
    alter table public.custom_domains
      add constraint custom_domains_root_url_valid check (
        root_redirect_url = ''
        or root_redirect_url ~ '^https?://[^[:space:]]+$'
      );
  end if;
end
$$;

create or replace function public.touch_custom_domains_updated_at()
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

drop trigger if exists custom_domains_touch_updated_at on public.custom_domains;
create trigger custom_domains_touch_updated_at
  before update on public.custom_domains
  for each row execute function public.touch_custom_domains_updated_at();

alter table public.custom_domains enable row level security;