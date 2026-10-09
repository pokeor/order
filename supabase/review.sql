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
