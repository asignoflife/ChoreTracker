-- Everyone can customise their own profile: photo, name, and birthday.
-- Email and password changes go through Supabase Auth in the app.
-- Apply after family_calendar_birthdays.sql.
--
-- Profiles are deliberately not writable by the app (family_invitations.sql
-- guards every direct write), so this adds one narrow function that can only
-- touch the signed-in caller's own row.
begin;

alter table public.profiles add column if not exists avatar_url text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_url_length'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_url_length
      check (avatar_url is null or (
        pg_catalog.char_length(avatar_url) between 1 and 500 and avatar_url like 'https://%'
      ));
  end if;
end;
$$;

create or replace function public.update_my_profile(new_full_name text, new_birthday date, new_avatar_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare cleaned_name text := pg_catalog.btrim(coalesce(new_full_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in to update your profile' using errcode = '42501';
  end if;
  if cleaned_name = '' or pg_catalog.char_length(cleaned_name) > 100 then
    raise exception 'A name of at most 100 characters is required';
  end if;
  if new_birthday is not null and (new_birthday < date '1900-01-01' or new_birthday > current_date) then
    raise exception 'Choose a real birthday in the past';
  end if;
  if new_avatar_url is not null and (
      pg_catalog.char_length(new_avatar_url) > 500 or new_avatar_url not like 'https://%'
    ) then
    raise exception 'That photo link is not valid';
  end if;

  update public.profiles
    set full_name = cleaned_name,
        birthday = new_birthday,
        avatar_url = new_avatar_url
    where id = auth.uid();
end;
$$;
revoke all on function public.update_my_profile(text, date, text) from public, anon;
grant execute on function public.update_my_profile(text, date, text) to authenticated;

commit;
