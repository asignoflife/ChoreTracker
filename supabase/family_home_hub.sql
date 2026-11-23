-- Family home hub: a shared tablet can show the day's chores, the calendar,
-- and the reward menu. Kids mark their own chores done by typing a short PIN.
--
-- The PIN is not a login: the tablet stays signed in with a parent account,
-- and a kid's PIN only authorises "mark my chore done" for that one kid. PINs
-- are stored as bcrypt hashes in a table that clients cannot read or write.
-- A wrong PIN is counted server-side and five misses lock that kid out for
-- five minutes, so a short PIN is not brute-forceable from the couch.
--
-- Apply after family_access.sql and family_chore_due_dates.sql.
-- Back up and test in staging before applying to a live project.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('choretracker_private.current_family()') is null
     or pg_catalog.to_regprocedure('choretracker_private.current_role()') is null
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.profiles'::regclass
         and tgname = 'choretracker_guard_profiles'
         and tgenabled in ('O', 'A')
     ) then
    raise exception 'Install and verify family_invitations.sql and family_access.sql before adding the home hub.';
  end if;
end;
$$;

-- Supabase installs pgcrypto in the extensions schema. Fail with a clear
-- message if this project keeps it somewhere else, instead of leaving the
-- hub functions unable to hash a PIN.
create schema if not exists extensions;
do $$
declare crypto_schema text;
begin
  select n.nspname into crypto_schema
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto';
  if crypto_schema is null then
    create extension pgcrypto with schema extensions;
  elsif crypto_schema <> 'extensions' then
    raise exception 'pgcrypto is installed in schema %, but the home hub expects extensions.', crypto_schema;
  end if;
end;
$$;

-- Only the fact that a PIN exists is public within the family; the hash stays
-- in hub_pins below.
alter table public.profiles add column if not exists hub_pin_set_at timestamptz;

create table if not exists public.hub_pins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.hub_pins enable row level security;
revoke all on public.hub_pins from public, anon, authenticated;

-- A kid creates or replaces their own 4-6 digit PIN. The app never stores the
-- PIN itself, and nobody can read another person's PIN back out.
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
  if caller_role is distinct from 'kid' then
    raise exception 'Only a kid can set a home hub PIN' using errcode = '42501';
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

-- Mark a chore done after checking the assigned kid's PIN. It returns a result
-- object rather than raising on a wrong PIN, because an exception would roll
-- back the failed-attempt counter and make the lockout useless.
create or replace function public.complete_chore_with_hub_pin(p_chore_id bigint, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller_family text;
  caller_role text;
  target public.chores%rowtype;
  target_name text;
  pin_row public.hub_pins%rowtype;
  cleaned_pin text := pg_catalog.btrim(coalesce(p_pin, ''));
  attempts integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to use the family hub' using errcode = '42501';
  end if;
  select p.family_code, p.role into caller_family, caller_role
    from public.profiles p where p.id = auth.uid();
  if caller_family is null then
    raise exception 'A family profile is required' using errcode = '42501';
  end if;

  select * into target from public.chores c
    where c.id = p_chore_id and c.family_code = caller_family
    for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'That chore could not be found.');
  end if;
  if target.assigned_to_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'That chore is not assigned to a kid.');
  end if;
  if caller_role = 'kid' and target.assigned_to_id is distinct from auth.uid() then
    raise exception 'Children can only complete their own chores' using errcode = '42501';
  end if;
  -- Older rows can have no status; the app treats those as pending.
  if coalesce(target.status, 'pending') is distinct from 'pending' or target.is_completed then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'That chore is already marked done.');
  end if;

  select p.full_name into target_name from public.profiles p
    where p.id = target.assigned_to_id
      and p.family_code = caller_family
      and p.role = 'kid';
  if target_name is null then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'That chore is not assigned to a kid in this family.');
  end if;

  -- Reject anything that is not a PIN shape before doing any bcrypt work.
  if cleaned_pin !~ '^[0-9]{4,6}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'message', 'That PIN is not right.');
  end if;

  select * into pin_row from public.hub_pins hp
    where hp.profile_id = target.assigned_to_id
    for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'message', target_name || ' has not set a home hub PIN yet.'
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
      where profile_id = target.assigned_to_id;
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
    where profile_id = target.assigned_to_id;

  -- The child's own submit transition. A parent's session can do the same
  -- thing for any kid in the family; the PIN is still required on the hub.
  update public.chores
    set is_completed = true, status = 'submitted'
    where id = target.id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'message', target_name || '''s chore is marked done. A parent will approve it.',
    'kid_name', target_name
  );
end;
$$;
revoke all on function public.complete_chore_with_hub_pin(bigint, text) from public, anon;
grant execute on function public.complete_chore_with_hub_pin(bigint, text) to authenticated;

commit;
