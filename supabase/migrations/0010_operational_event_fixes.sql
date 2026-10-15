-- 0010_operational_event_fixes.sql
--
-- Two defects in 0008, found by exercising the function against a real
-- Postgres during launch verification:
--
--   1. record_operational_event() swallowed every error with `when others then
--      null`. A failed insert was therefore indistinguishable from a successful
--      one: an observability system could be completely broken while reporting
--      nothing at all. It now returns a boolean so callers and tests can tell
--      the difference.
--
--   2. The function was never called from application code, so
--      operational_events was an empty table in practice.
--
-- The request-safety behaviour is deliberately preserved: a failure here must
-- never break the request being observed. It is reported, not raised.

-- The return type changes from void to boolean, which CREATE OR REPLACE
-- refuses to do, so the old signature is dropped explicitly. Nothing depends on
-- it: it is only ever called through PostgREST.
drop function if exists public.record_operational_event(text, text, jsonb);

create or replace function public.record_operational_event(
  p_event text,
  p_severity text default 'info',
  p_context jsonb default '{}'
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_severity text := lower(coalesce(nullif(p_severity, ''), 'info'));
begin
  -- Normalise rather than reject: a caller passing an unexpected severity must
  -- not be able to lose the event, and must not be able to inject an arbitrary
  -- level that alerting does not understand. Case is folded first so 'ERROR'
  -- and 'error' cannot be silently demoted to 'info' and disappear from alerts.
  if v_severity not in ('info', 'warn', 'error') then
    v_severity := case
      when v_severity = any (array['critical', 'fatal']) then 'error'
      when v_severity = any (array['warning', 'err']) then 'warn'
      else 'info'
    end;
  end if;

  insert into public.operational_events (event, severity, context)
  values (p_event, v_severity, coalesce(p_context, '{}'::jsonb));

  return true;
exception
  -- Observability must never break the request it is observing.
  when others then
    return false;
end;
$$;

revoke all on function public.record_operational_event(text, text, jsonb) from public;
grant execute on function public.record_operational_event(text, text, jsonb) to service_role;

-- events + severity is the index alerting queries against, and the table has no
-- retention sweep wired up yet, so keep it cheap to scan.
create index if not exists operational_events_event_created_idx
  on public.operational_events (event, created_at desc);

-- Bound unbounded growth. operational_events has no other pruning path, so an
-- unmaintained table would otherwise grow without limit and slow the database.
create or replace function public.sweep_operational_events(p_keep_days integer default 30)
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with removed as (
    delete from public.operational_events
    where created_at < now() - make_interval(days => greatest(p_keep_days, 1))
    returning 1
  )
  select count(*)::integer from removed;
$$;

revoke all on function public.sweep_operational_events(integer) from public;
grant execute on function public.sweep_operational_events(integer) to service_role;
