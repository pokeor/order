-- Pokeor city: security hardening patch. Run once in Supabase -> SQL Editor (after schema.sql). Idempotent.

-- 1. One shop per owner, enforced by the database (the policy count check alone can race).
create unique index if not exists shops_one_per_owner on public.shops (owner);

-- 2. Allow only YouTube / Twitch for live links, and only our own storage for listing images.
alter table public.shops drop constraint if exists shops_live_host;
alter table public.shops add constraint shops_live_host
  check (live_url is null or live_url ~* '^https://(www\.|m\.)?(youtube\.com|youtu\.be|twitch\.tv)/') not valid;
alter table public.listings drop constraint if exists listings_image_host;
alter table public.listings add constraint listings_image_host
  check (image_url is null or image_url ~ '^https://igzdifwywtgctiihclae\.supabase\.co/storage/v1/object/public/listings/') not valid;

-- 3. Cap listings per shop (anti-spam / storage abuse).
create or replace function public.guard_listing_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.listings where shop_id = new.shop_id) >= 60 then
    raise exception 'listing limit reached';
  end if;
  return new;
end $$;
drop trigger if exists listings_guard_ins on public.listings;
create trigger listings_guard_ins before insert on public.listings for each row execute function public.guard_listing_insert();

-- 4. Reports: only about live shops, throttled globally and per shop (the endpoint is open to anonymous visitors).
create or replace function public.guard_report_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.shop_id is null or not exists (select 1 from public.shops where id = new.shop_id and status = 'approved') then
    raise exception 'unknown shop';
  end if;
  if (select count(*) from public.reports where created_at > now() - interval '1 minute') >= 20 then
    raise exception 'too many reports';
  end if;
  if (select count(*) from public.reports where shop_id = new.shop_id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many reports for this shop';
  end if;
  return new;
end $$;
drop trigger if exists reports_guard_ins on public.reports;
create trigger reports_guard_ins before insert on public.reports for each row execute function public.guard_report_insert();

-- 5. Image bucket: size + type limits (no HTML/SVG served from our storage domain), owners-only uploads, quota, no public listing.
update storage.buckets set file_size_limit = 1572864, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] where id = 'listings';
drop policy if exists listing_img_insert on storage.objects;
create policy listing_img_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'listings'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.shops s where s.owner = auth.uid())
  and (select count(*) from storage.objects o where o.bucket_id = 'listings' and (storage.foldername(o.name))[1] = auth.uid()::text) < 80);
drop policy if exists listing_img_read on storage.objects;   -- public URLs keep working; this only stopped anyone listing every file
create policy listing_img_read on storage.objects for select to authenticated using (bucket_id = 'listings' and (storage.foldername(name))[1] = auth.uid()::text);

-- 6. Least privilege at the table level (RLS stays the main gate; this is defence in depth).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke insert, update, delete on public.shops from anon;
revoke insert, update, delete on public.listings from anon;
revoke select on public.reports from anon;
revoke update, delete on public.reports from anon, authenticated;
grant insert on public.reports to anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_shop_update() from public, anon, authenticated;
revoke execute on function public.guard_shop_insert() from public, anon, authenticated;
revoke execute on function public.guard_listing_insert() from public, anon, authenticated;
revoke execute on function public.guard_report_insert() from public, anon, authenticated;

-- 7. OPTIONAL, after you enrol an authenticator app (Authentication -> MFA) on your own account:
--    admin powers only with a second factor. Do NOT run before enrolling or you lock yourself out.
-- create or replace function public.is_admin() returns boolean language sql security definer set search_path = public stable as $$
--   select coalesce((select is_admin from public.profiles where id = auth.uid()), false) and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
-- $$;

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

-- Pokeor city: re-review on edits. An approved shop that changes its name or tagline goes back to 'pending'
-- (hidden from the city until you approve again) so a clean shop cannot be renamed into something abusive.
-- Run once in Supabase -> SQL Editor. Replaces the guard function from schema.sql, keeps its other rules.
create or replace function public.guard_shop_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.owner := old.owner; new.lot := old.lot; new.created_at := old.created_at; new.status := old.status;
    if old.status = 'approved' and (new.name is distinct from old.name or new.tagline is distinct from old.tagline) then
      new.status := 'pending'; new.live_url := null;
    end if;
    if new.status <> 'approved' then new.live_url := null; end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_shop_update() from public, anon, authenticated;
