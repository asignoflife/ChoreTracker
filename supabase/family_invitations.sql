-- Review and test on a staging project before applying. This migration changes
-- signup and profile-write permissions; deploy the updated app at the same time.
-- Existing profiles are retained, including their current roles. Review them
-- before applying: any existing parent can create invitations for that family.
-- Existing auth.users INSERT triggers may already create profiles or enforce
-- other signup rules. This migration deliberately stops if one is present;
-- those triggers must be reviewed and integrated before this can be installed.
begin;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and (t.tgtype & 4) = 4
      and t.tgname <> 'choretracker_create_family_profile'
  ) then
    raise exception 'Existing auth.users INSERT trigger found. Review and integrate it before applying this migration.';
  end if;
end;
$$;

create schema if not exists choretracker_private;
revoke all on schema choretracker_private from public, anon;
-- family_access.sql grants authenticated USAGE for its RLS helpers. Preserve it
-- when reapplying this migration, or existing family access will break.
do $$
begin
  if pg_catalog.to_regprocedure('choretracker_private.current_family()') is null then
    revoke all on schema choretracker_private from authenticated;
  end if;
end;
$$;

create table if not exists choretracker_private.choretracker_families (
  family_code text primary key
);

-- Reserve all existing family identifiers so new families cannot collide.
insert into choretracker_private.choretracker_families (family_code)
select distinct family_code from public.profiles where family_code is not null
on conflict do nothing;

create table if not exists choretracker_private.choretracker_invitations (
  code text primary key,
  family_code text not null references choretracker_private.choretracker_families (family_code),
  invited_role text not null check (invited_role in ('parent', 'kid')),
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_by uuid references auth.users (id),
  used_at timestamptz
);
revoke all on choretracker_private.choretracker_families, choretracker_private.choretracker_invitations from public, anon, authenticated;

-- Existing RLS policies are not sufficient if they permit clients to edit role
-- or family_code. Only trusted database functions may create/change profiles.
revoke insert, update, delete on public.profiles from public, anon, authenticated;

create or replace function choretracker_private.choretracker_guard_profiles()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Profile membership cannot be modified directly' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function choretracker_private.choretracker_guard_profiles() from public, anon, authenticated;

drop trigger if exists choretracker_guard_profiles on public.profiles;
create trigger choretracker_guard_profiles
before insert or update or delete on public.profiles
for each row execute function choretracker_private.choretracker_guard_profiles();

-- Lets the app refuse signup until this migration has been installed.
create or replace function public.family_signup_version()
returns integer language sql stable security invoker set search_path = ''
as $$ select 1 $$;
revoke all on function public.family_signup_version() from public;
grant execute on function public.family_signup_version() to anon, authenticated;

create or replace function public.create_family_invitation(invited_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  caller_family text;
  invitation_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to create invitations' using errcode = '42501';
  end if;
  if invited_role is null or invited_role not in ('parent', 'kid') then
    raise exception 'Choose parent or kid';
  end if;

  select p.family_code into caller_family
    from public.profiles p
    where p.id = auth.uid() and p.role = 'parent';
  if caller_family is null or caller_family = '' then
    raise exception 'Only a family parent can create invitations' using errcode = '42501';
  end if;
  -- Coordinate with member removal and recheck after obtaining the family lock.
  perform 1 from choretracker_private.choretracker_families f where f.family_code = caller_family for update;
  if not found or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'parent' and p.family_code = caller_family) then
    raise exception 'Only a family parent can create invitations' using errcode = '42501';
  end if;
  if (select count(*) from choretracker_private.choretracker_invitations i
      where i.created_by = auth.uid() and i.used_at is null and i.expires_at > pg_catalog.now()) >= 20 then
    raise exception 'Too many active invitations. Please wait for one to be used or expire.';
  end if;

  invitation_code := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
                     pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into choretracker_private.choretracker_invitations (code, family_code, invited_role, created_by)
    values (invitation_code, caller_family, invited_role, auth.uid());
  return invitation_code;
end;
$$;
revoke all on function public.create_family_invitation(text) from public, anon;
grant execute on function public.create_family_invitation(text) to authenticated;

create or replace function choretracker_private.choretracker_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  signup_mode text := new.raw_user_meta_data ->> 'signup_mode';
  person_name text := pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name');
  invitation_code text := pg_catalog.lower(pg_catalog.btrim(new.raw_user_meta_data ->> 'invitation_code'));
  assigned_family text;
  assigned_role text;
begin
  if person_name is null or person_name = '' or pg_catalog.length(person_name) > 100 then
    raise exception 'A name of at most 100 characters is required';
  end if;

  if signup_mode = 'create_family' then
    loop
      assigned_family := pg_catalog.upper(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''));
      insert into choretracker_private.choretracker_families (family_code) values (assigned_family)
        on conflict do nothing;
      exit when found;
    end loop;
    assigned_role := 'parent';
  elsif signup_mode = 'join_family' then
    if invitation_code is null or invitation_code !~ '^[0-9a-f]{64}$' then
      raise exception 'A valid invitation code is required';
    end if;
    -- UPDATE locks the row and makes a code single-use even for concurrent signups.
    update choretracker_private.choretracker_invitations i
      set used_by = new.id, used_at = pg_catalog.now()
      where i.code = invitation_code and i.used_at is null and i.expires_at > pg_catalog.now()
      returning i.family_code, i.invited_role into assigned_family, assigned_role;
    if not found then
      raise exception 'Invitation is invalid, expired, or already used';
    end if;
  else
    raise exception 'Create a family or use an invitation to sign up';
  end if;

  insert into public.profiles (id, full_name, family_code, role)
    values (new.id, person_name, assigned_family, assigned_role);
  -- The invitation is a bearer credential, not durable user metadata.
  update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'invitation_code'
    where id = new.id;
  return new;
end;
$$;
revoke all on function choretracker_private.choretracker_create_profile() from public, anon, authenticated;

drop trigger if exists choretracker_create_family_profile on auth.users;
create trigger choretracker_create_family_profile
  after insert on auth.users for each row execute function choretracker_private.choretracker_create_profile();

commit;
