-- Pokeor city: player moderation (reports + shared ban list). Run once in Supabase -> SQL Editor. Idempotent.

create table if not exists public.player_reports (
  id uuid primary key default gen_random_uuid(),
  reported_uid text not null check (reported_uid ~ '^[A-Za-z0-9-]{6,40}$'),
  reported_name text check (char_length(reported_name) <= 14),
  reason text not null check (char_length(reason) between 2 and 200),
  evidence text check (char_length(evidence) <= 600),
  created_at timestamptz not null default now()
);
create table if not exists public.banned_uids (
  uid text primary key check (uid ~ '^[A-Za-z0-9-]{6,40}$'),
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
alter table public.player_reports enable row level security;
alter table public.banned_uids enable row level security;

drop policy if exists player_reports_insert on public.player_reports;
create policy player_reports_insert on public.player_reports for insert with check (true);
drop policy if exists player_reports_select on public.player_reports;
create policy player_reports_select on public.player_reports for select to authenticated using (public.is_admin());
drop policy if exists player_reports_delete on public.player_reports;
create policy player_reports_delete on public.player_reports for delete to authenticated using (public.is_admin());

drop policy if exists banned_select on public.banned_uids;
create policy banned_select on public.banned_uids for select using (true);        -- every client needs the list
drop policy if exists banned_write on public.banned_uids;
create policy banned_write on public.banned_uids for insert to authenticated with check (public.is_admin());
drop policy if exists banned_delete on public.banned_uids;
create policy banned_delete on public.banned_uids for delete to authenticated using (public.is_admin());

-- throttle the open report endpoint: 15/min overall, 5 per reported id per day
create or replace function public.guard_player_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.player_reports where created_at > now() - interval '1 minute') >= 15 then raise exception 'too many reports'; end if;
  if (select count(*) from public.player_reports where reported_uid = new.reported_uid and created_at > now() - interval '1 day') >= 5 then raise exception 'already reported'; end if;
  return new;
end $$;
drop trigger if exists player_reports_guard on public.player_reports;
create trigger player_reports_guard before insert on public.player_reports for each row execute function public.guard_player_report();

revoke all on public.player_reports, public.banned_uids from anon, authenticated;
grant insert on public.player_reports to anon, authenticated;
grant select, delete on public.player_reports to authenticated;
grant select on public.banned_uids to anon, authenticated;
grant insert, delete on public.banned_uids to authenticated;
revoke execute on function public.guard_player_report() from public, anon, authenticated;
