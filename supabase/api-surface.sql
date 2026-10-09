-- Pokeor city: shrink the public API surface. Run once in Supabase -> SQL Editor. Idempotent.
-- (The project URL and the publishable key are public by design; what matters is how little they can reach.)

-- 1. No GraphQL endpoint (/graphql/v1) - the site does not use it.
do $$ begin drop extension if exists pg_graphql; exception when others then raise notice 'graphql: %', sqlerrm; end $$;

-- 2. Tables/functions created in the future are NOT reachable through the API until explicitly granted.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 3. Anonymous visitors can only read the two public tables; nothing else, no DDL-ish privileges.
revoke all on public.shops, public.listings from anon;
grant select on public.shops, public.listings to anon;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- 4. Cheap queries only: short timeouts for API roles, and a hard cap on rows per request (anti-scraping / anti-DoS).
alter role anon set statement_timeout = '5s';
alter role authenticated set statement_timeout = '8s';
alter role authenticator set pgrst.db_max_rows = '200';
notify pgrst, 'reload config';
