-- Adds an optional location to calendar events and birthdays to profiles.
-- Apply after family_calendar.sql. Additive and safe to re-run.
-- Birthdays are stored once per person and shown in the calendar every year;
-- they are not copied into calendar_events.
begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'calendar_events')
     or pg_catalog.to_regprocedure('choretracker_private.current_family()') is null then
    raise exception 'Install family_calendar.sql before adding locations and birthdays.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.profiles'::regclass
      and tgname = 'choretracker_guard_profiles' and tgenabled in ('O', 'A')) then
    raise exception 'Install family_invitations.sql and family_access.sql first.';
  end if;
end;
$$;

alter table public.calendar_events add column if not exists location text;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.calendar_events'::regclass and conname = 'calendar_events_location_length'
  ) then
    alter table public.calendar_events
      add constraint calendar_events_location_length
      check (location is null or pg_catalog.char_length(pg_catalog.btrim(location)) between 1 and 200);
  end if;
end;
$$;

alter table public.profiles add column if not exists birthday date;
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_birthday_range'
  ) then
    alter table public.profiles
      add constraint profiles_birthday_range
      check (birthday is null or (birthday >= date '1900-01-01' and birthday <= date '2100-01-01'));
  end if;
end;
$$;

-- Profiles can only be written by trusted database code, so birthdays are set
-- through this parent-only function rather than a direct table update.
create or replace function public.set_family_birthday(member_id uuid, birthday date)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_family text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change a birthday' using errcode = '42501';
  end if;
  select p.family_code into caller_family
    from public.profiles p
    where p.id = auth.uid() and p.role = 'parent';
  if caller_family is null or caller_family = '' then
    raise exception 'Only a family parent can change birthdays' using errcode = '42501';
  end if;
  if member_id is null or not exists (
    select 1 from public.profiles p where p.id = member_id and p.family_code = caller_family
  ) then
    raise exception 'That member is not in your family' using errcode = '42501';
  end if;
  if birthday is not null and (birthday < date '1900-01-01' or birthday > current_date) then
    raise exception 'Choose a real birthday in the past';
  end if;
  update public.profiles set birthday = $2 where id = member_id;
end;
$$;
revoke all on function public.set_family_birthday(uuid, date) from public, anon;
grant execute on function public.set_family_birthday(uuid, date) to authenticated;

commit;
