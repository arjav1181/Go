-- Roles the migrations expect.
--
-- Every migration file does `grant execute ... to service_role` and touches
-- `anon` / `authenticated`. On a real Supabase project those roles are managed
-- for you. On a plain postgres:17 image they do not exist, so migration 0001
-- fails on its first grant and nothing after it runs.
--
-- Mounted into /docker-entrypoint-initdb.d, which the official image executes
-- in filename order — the "00-" prefix puts this ahead of 0001_init.sql.
--
-- Written to be re-runnable. Roles are cluster-wide rather than per-database,
-- so on a reused cluster these already exist and a bare `create role` would
-- abort the whole init and take the migrations down with it.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  -- bypassrls so this role can read tables whose row level security is
  -- deliberately policy-free. The app connects with the service role key.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;