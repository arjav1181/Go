-- P2 owner-only API keys.
--
-- Only a SHA-256 hash is stored. The full key is shown once at creation and
-- cannot be recovered afterwards. `key_prefix` exists purely so the owner can
-- identify a key in the UI.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null,
  key_prefix text not null,
  created_by uuid not null,
  -- Denormalised so authorisation does not need an auth-admin lookup per request.
  -- The OWNER_EMAILS allowlist is re-checked against this on every API call.
  owner_email text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  -- Comma-separated scope list, e.g. 'links:read,links:write'.
  scopes text not null default 'links:read',
  constraint api_keys_name_format check (name ~ '^[a-z0-9][a-z0-9 _-]{0,63}$')
);

-- Phase 3: key rotation lineage.
alter table public.api_keys add column if not exists rotated_from uuid
  references public.api_keys (id) on delete set null;

create index if not exists api_keys_rotated_from_idx on public.api_keys (rotated_from);

create unique index if not exists api_keys_hash_uidx on public.api_keys (key_hash);
create index if not exists api_keys_owner_idx on public.api_keys (created_by);

alter table public.api_keys enable row level security;

-- Optional link aliases on additional domains (P2).
-- `domain` scopes a slug to a host. When ALIAS_DOMAINS is unset the column is
-- ignored and every link resolves on the canonical host, so this is a no-op by
-- default and can be enabled purely through configuration.
alter table public.links
  add column if not exists domain text not null default '';

create index if not exists links_domain_slug_idx on public.links (domain, slug);