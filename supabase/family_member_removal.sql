-- Apply only after family_invitations.sql and family_access.sql have been
-- installed and tested. Back up and test in staging before applying to live.
-- Removing a member moves their existing profile to an isolated family; it
-- does not delete their account, their old chores, or redemption history.
-- This also expires all unused invitations to the old family.
begin;

do $$
begin
  if (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('profiles', 'chores', 'chore_templates', 'rewards', 'redemptions') and c.relrowsecurity) <> 5
     or (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and (tablename, policyname) in (
       ('profiles', 'ct_profiles_read'), ('chores', 'ct_chores_read'), ('chores', 'ct_chores_insert'), ('chores', 'ct_chores_update'),
       ('chore_templates', 'ct_templates_read'), ('chore_templates', 'ct_templates_insert'), ('chore_templates', 'ct_templates_update'),
       ('rewards', 'ct_rewards_read'), ('rewards', 'ct_rewards_insert'), ('redemptions', 'ct_redemptions_read'),
       ('redemptions', 'ct_redemptions_insert'), ('redemptions', 'ct_redemptions_update')
     )) <> 12
     or exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename in ('profiles', 'chores', 'chore_templates', 'rewards', 'redemptions') and (tablename, policyname) not in (
       ('profiles', 'ct_profiles_read'), ('chores', 'ct_chores_read'), ('chores', 'ct_chores_insert'), ('chores', 'ct_chores_update'),
       ('chore_templates', 'ct_templates_read'), ('chore_templates', 'ct_templates_insert'), ('chore_templates', 'ct_templates_update'),
       ('rewards', 'ct_rewards_read'), ('rewards', 'ct_rewards_insert'), ('redemptions', 'ct_redemptions_read'),
       ('redemptions', 'ct_redemptions_insert'), ('redemptions', 'ct_redemptions_update')
     ))
     or not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'choretracker_guard_profiles' and tgenabled in ('O', 'A')) then
    raise exception 'Install and verify family_access.sql before enabling member removal.';
  end if;
end;
$$;

-- Serialize invitation creation with removal and recheck membership after the
-- lock. A just-removed parent must not be able to create an old-family code.
create or replace function public.create_family_invitation(invited_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare caller_family text; invitation_code text;
begin
  if auth.uid() is null then raise exception 'Sign in to create invitations' using errcode = '42501'; end if;
  if invited_role is null or invited_role not in ('parent', 'kid') then raise exception 'Choose parent or kid'; end if;
  select p.family_code into caller_family from public.profiles p where p.id = auth.uid() and p.role = 'parent';
  if caller_family is null or caller_family = '' then raise exception 'Only a family parent can create invitations' using errcode = '42501'; end if;
  perform 1 from choretracker_private.choretracker_families f where f.family_code = caller_family for update;
  if not found or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'parent' and p.family_code = caller_family) then
    raise exception 'Only a family parent can create invitations' using errcode = '42501';
  end if;
  if (select count(*) from choretracker_private.choretracker_invitations i where i.created_by = auth.uid() and i.used_at is null and i.expires_at > pg_catalog.now()) >= 20 then
    raise exception 'Too many active invitations. Please wait for one to be used or expire.';
  end if;
  invitation_code := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into choretracker_private.choretracker_invitations (code, family_code, invited_role, created_by) values (invitation_code, caller_family, invited_role, auth.uid());
  return invitation_code;
end;
$$;
revoke all on function public.create_family_invitation(text) from public, anon;
grant execute on function public.create_family_invitation(text) to authenticated;

create or replace function public.remove_family_member(member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare caller_family text; isolated_family text;
begin
  if auth.uid() is null or member_id is null or member_id = auth.uid() then
    raise exception 'A parent must choose another family member' using errcode = '42501';
  end if;
  select p.family_code into caller_family from public.profiles p where p.id = auth.uid() and p.role = 'parent';
  if caller_family is null or caller_family = '' then raise exception 'Only a family parent can remove members' using errcode = '42501'; end if;
  perform 1 from choretracker_private.choretracker_families f where f.family_code = caller_family for update;
  if not found or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'parent' and p.family_code = caller_family) then
    raise exception 'Only a family parent can remove members' using errcode = '42501';
  end if;
  perform 1 from public.profiles p where p.id = member_id and p.family_code = caller_family for update;
  if not found then raise exception 'That member is not in your family' using errcode = '42501'; end if;
  loop
    isolated_family := pg_catalog.upper(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''));
    insert into choretracker_private.choretracker_families (family_code) values (isolated_family) on conflict do nothing;
    exit when found;
  end loop;
  update choretracker_private.choretracker_invitations i set expires_at = least(i.expires_at, pg_catalog.now())
    where i.family_code = caller_family and i.used_at is null and i.expires_at > pg_catalog.now();
  update public.profiles set family_code = isolated_family where id = member_id;
end;
$$;
revoke all on function public.remove_family_member(uuid) from public, anon;
grant execute on function public.remove_family_member(uuid) to authenticated;
commit;
