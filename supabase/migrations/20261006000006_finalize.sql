-- BimbingTA Copilot — 0006 final hardening
-- Defensive: no table in public is reachable by anon; every table has RLS enabled.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- trigger/helper functions live in schema app (not exposed by PostgREST)
revoke execute on all functions in schema app from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;

do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise exception 'RLS missing on public.%', r.relname;
  end loop;
end $$;
