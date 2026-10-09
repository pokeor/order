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
