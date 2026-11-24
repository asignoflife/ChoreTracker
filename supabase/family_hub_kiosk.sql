-- Hub kiosk lock: the shared tablet stays signed in as a parent, but leaving
-- the hub for the parent app requires typing that parent's own hub PIN.
--
-- This reuses public.hub_pins from family_home_hub.sql. A kid's PIN still only
-- authorises "mark my chore done"; a parent's PIN only authorises leaving the
-- hub. Attempts are counted server-side, so reloading the hub cannot reset a
-- brute-force, and five misses lock the unlock for five minutes.
--
-- Apply after family_home_hub.sql. Safe to re-run.
begin;

do $$
begin
  if pg_catalog.to_regclass('public.hub_pins') is null
     or pg_catalog.to_regprocedure('public.complete_chore_with_hub_pin(bigint, text)') is null then
    raise exception 'Install family_home_hub.sql before adding the hub kiosk lock.';
  end if;
end;
$$;

-- Parents can set a hub PIN too. Their PIN is only used to unlock the tablet;
-- chores stay assigned to kids and keep using the kids' own PINs.
create or replace function public.set_my_hub_pin(new_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  caller_role text;
  cleaned_pin text := pg_catalog.btrim(coalesce(new_pin, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to set a home hub PIN' using errcode = '42501';
  end if;
  select p.role into caller_role from public.profiles p where p.id = auth.uid();
  if caller_role is null then
    raise exception 'A family profile is required to set a home hub PIN' using errcode = '42501';
  end if;
  if cleaned_pin !~ '^[0-9]{4,6}$' then
    raise exception 'Choose a PIN of 4 to 6 digits' using errcode = '22023';
  end if;

  insert into public.hub_pins (profile_id, pin_hash, failed_attempts, locked_until)
    values (auth.uid(), extensions.crypt(cleaned_pin, extensions.gen_salt('bf', 8)), 0, null)
    on conflict (profile_id) do update
      set pin_hash = excluded.pin_hash,
          failed_attempts = 0,
          locked_until = null,
          updated_at = pg_catalog.now();

  update public.profiles set hub_pin_set_at = pg_catalog.now() where id = auth.uid();
end;
$$;
revoke all on function public.set_my_hub_pin(text) from public, anon;
grant execute on function public.set_my_hub_pin(text) to authenticated;

-- Check the caller's own parent PIN before the hub opens the rest of the app.
-- Like the chore function, it returns a result object instead of raising on a
-- wrong PIN so the failed-attempt counter actually commits.
create or replace function public.verify_hub_unlock_pin(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller_role text;
  pin_row public.hub_pins%rowtype;
  cleaned_pin text := pg_catalog.btrim(coalesce(p_pin, ''));
  attempts integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to use the family hub' using errcode = '42501';
  end if;
  select p.role into caller_role from public.profiles p where p.id = auth.uid();
  if caller_role is distinct from 'parent' then
    raise exception 'Only a parent can unlock parent controls' using errcode = '42501';
  end if;

  -- Reject anything that is not a PIN shape before doing any bcrypt work.
  if cleaned_pin !~ '^[0-9]{4,6}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'That PIN is not right.');
  end if;

  select * into pin_row from public.hub_pins hp
    where hp.profile_id = auth.uid()
    for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'message', 'Set a parent unlock PIN on your profile first.'
    );
  end if;
  if pin_row.locked_until is not null and pin_row.locked_until > pg_catalog.now() then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'Too many wrong PINs. Try again in a few minutes.');
  end if;

  attempts := case
    when pin_row.locked_until is not null and pin_row.locked_until <= pg_catalog.now() then 0
    else pin_row.failed_attempts
  end;

  if extensions.crypt(cleaned_pin, pin_row.pin_hash) is distinct from pin_row.pin_hash then
    update public.hub_pins
      set failed_attempts = attempts + 1,
          locked_until = case
            when attempts + 1 >= 5 then pg_catalog.now() + interval '5 minutes'
            else null
          end,
          updated_at = pg_catalog.now()
      where profile_id = auth.uid();
    if attempts + 1 >= 5 then
      return pg_catalog.jsonb_build_object(
        'ok', false,
        'message', 'Too many wrong PINs. Try again in five minutes.'
      );
    end if;
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'That PIN is not right.');
  end if;

  update public.hub_pins
    set failed_attempts = 0, locked_until = null, updated_at = pg_catalog.now()
    where profile_id = auth.uid();

  return pg_catalog.jsonb_build_object('ok', true, 'message', 'Parent controls unlocked.');
end;
$$;
revoke all on function public.verify_hub_unlock_pin(text) from public, anon;
grant execute on function public.verify_hub_unlock_pin(text) to authenticated;

commit;
