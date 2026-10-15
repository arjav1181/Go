-- Phase 4: shared rate limiting and operational visibility.
--
-- The in-memory limiter used for API keys does not work across multiple
-- instances, so the authoritative counters live in Postgres, which is already
-- shared by every instance.

create table if not exists public.rate_limit_buckets (
  -- Caller identity: API key id, session hash, or an IP-derived opaque value.
  -- Never a raw IP address; callers pass a keyed hash of whatever they hold.
  bucket_key text not null,
  scope text not null,
  window_start timestamptz not null,
  hit_count bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint rate_limit_buckets_unique unique (bucket_key, scope, window_start)
);

-- Only the current window is queried, so this stays small.
create index if not exists rate_limit_buckets_window_idx
  on public.rate_limit_buckets (window_start);

-- Drop buckets that can no longer be current.
create index if not exists rate_limit_buckets_sweep_idx
  on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;

-- Atomically increment and return the running count for this window.
-- The upsert makes concurrent callers safe without an application-level lock.
create or replace function public.rate_limit_hit(
  p_bucket_key text,
  p_scope text,
  p_window_seconds integer
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count bigint;
begin
  -- Fixed windows aligned to the window length so all instances agree.
  v_window := to_timestamp(
    floor(extract(epoch from now()) / greatest(p_window_seconds, 1)) * greatest(p_window_seconds, 1)
  );

  insert into public.rate_limit_buckets (bucket_key, scope, window_start, hit_count)
  values (p_bucket_key, p_scope, v_window, 1)
  on conflict (bucket_key, scope, window_start)
  do update set
    hit_count = public.rate_limit_buckets.hit_count + 1,
    updated_at = now()
  returning hit_count into v_count;

  return v_count;
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer) from public;
grant execute on function public.rate_limit_hit(text, text, integer) to service_role;

-- Operational events: aggregate, non-personal, for alerting and diagnosis.
-- Deliberately holds no IP address, user agent, key material or link secrets.
create table if not exists public.operational_events (
  id bigint generated always as identity primary key,
  event text not null,
  severity text not null default 'info',
  -- Short, non-identifying context such as a route or error name.
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint operational_events_severity_valid check (severity in ('info', 'warn', 'error'))
);

create index if not exists operational_events_created_idx
  on public.operational_events (created_at desc);
create index if not exists operational_events_name_idx
  on public.operational_events (event, created_at desc);

alter table public.operational_events enable row level security;

create or replace function public.record_operational_event(
  p_event text,
  p_severity text default 'info',
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.operational_events (event, severity, context)
  values (p_event, p_severity, coalesce(p_context, '{}'::jsonb));
exception
  -- Observability must never break the request it is observing.
  when others then null;
end;
$$;

revoke all on function public.record_operational_event(text, text, jsonb) from public;
grant execute on function public.record_operational_event(text, text, jsonb) to service_role;