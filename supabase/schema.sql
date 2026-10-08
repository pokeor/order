-- Pokeor city: shops, listings, reports. Run once in Supabase -> SQL Editor.
-- Realtime presence/chat uses broadcast and needs no tables.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 28),
  tagline text check (char_length(tagline) <= 60),
  whatsapp text not null check (whatsapp ~ '^[0-9]{9,15}$'),
  color text not null default '#2f6f4f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  live_url text check (live_url is null or live_url ~ '^https://'),
  lot int unique check (lot between 0 and 39),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 60),
  price integer not null check (price between 0 and 1000000),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete cascade,
  reason text not null check (char_length(reason) <= 300),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- profile row on sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1)) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- owners cannot touch moderation fields
create or replace function public.guard_shop_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.owner := old.owner; new.status := old.status; new.lot := old.lot; new.created_at := old.created_at;
    if old.status <> 'approved' then new.live_url := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists shops_guard on public.shops;
create trigger shops_guard before update on public.shops for each row execute function public.guard_shop_update();

create or replace function public.guard_shop_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then new.status := 'pending'; new.lot := null; new.live_url := null; end if;
  return new;
end $$;
drop trigger if exists shops_guard_ins on public.shops;
create trigger shops_guard_ins before insert on public.shops for each row execute function public.guard_shop_insert();

alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.listings enable row level security;
alter table public.reports enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin());

-- shops: public sees approved only
drop policy if exists shops_select on public.shops;
create policy shops_select on public.shops for select using (status = 'approved' or owner = auth.uid() or public.is_admin());
drop policy if exists shops_insert on public.shops;
create policy shops_insert on public.shops for insert to authenticated with check (owner = auth.uid() and (select count(*) from public.shops s where s.owner = auth.uid()) < 1 or public.is_admin());
drop policy if exists shops_update on public.shops;
create policy shops_update on public.shops for update to authenticated using (owner = auth.uid() or public.is_admin()) with check (owner = auth.uid() or public.is_admin());
drop policy if exists shops_delete on public.shops;
create policy shops_delete on public.shops for delete to authenticated using (owner = auth.uid() or public.is_admin());

-- listings
drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings for select using (
  exists (select 1 from public.shops s where s.id = shop_id and (s.status = 'approved' or s.owner = auth.uid() or public.is_admin())));
drop policy if exists listings_write on public.listings;
create policy listings_write on public.listings for all to authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and (s.owner = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.shops s where s.id = shop_id and (s.owner = auth.uid() or public.is_admin())));

-- reports: anyone can file, only admins read
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (true);
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select using (public.is_admin());

-- listing images
insert into storage.buckets (id, name, public) values ('listings', 'listings', true) on conflict (id) do nothing;
drop policy if exists listing_img_read on storage.objects;
create policy listing_img_read on storage.objects for select using (bucket_id = 'listings');
drop policy if exists listing_img_insert on storage.objects;
create policy listing_img_insert on storage.objects for insert to authenticated with check (bucket_id = 'listings' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists listing_img_delete on storage.objects;
create policy listing_img_delete on storage.objects for delete to authenticated using (bucket_id = 'listings' and (storage.foldername(name))[1] = auth.uid()::text);

-- ONE manual step after you sign up on the site with your own account:
-- update public.profiles set is_admin = true where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
