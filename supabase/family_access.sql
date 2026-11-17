-- Based on the supplied schema audit. Test in staging and back up first.
-- This changes access policies, not existing rows or family memberships.
-- Apply after family_invitations.sql. Existing parent roles must be reviewed.
-- Photo storage bucket policies are separate and are NOT changed here.
-- Do not apply legacy family_stats.sql after this file; it replaces the
-- leaderboard function and can make sibling totals incomplete.
begin;

-- Fail rather than silently leaving an unknown permissive policy in effect.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('profiles', 'chores', 'chore_templates', 'rewards', 'redemptions')
      and (p.tablename, p.policyname) not in (
        ('profiles', 'Public profiles for testing'), ('chores', 'Public access for testing'),
        ('chore_templates', 'Public chore_templates for testing'), ('rewards', 'Public rewards for testing'),
        ('redemptions', 'Public redemptions for testing'),
        ('profiles', 'ct_profiles_read'), ('chores', 'ct_chores_read'),
        ('chores', 'ct_chores_insert'), ('chores', 'ct_chores_update'),
        ('chore_templates', 'ct_templates_read'), ('chore_templates', 'ct_templates_insert'),
        ('chore_templates', 'ct_templates_update'), ('rewards', 'ct_rewards_read'),
        ('rewards', 'ct_rewards_insert'), ('redemptions', 'ct_redemptions_read'),
        ('redemptions', 'ct_redemptions_insert'), ('redemptions', 'ct_redemptions_update')
      )
  ) then
    raise exception 'Unexpected policy found. Review current policies before installing family access.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('profiles', 'chores', 'chore_templates', 'rewards', 'redemptions')
      and not c.relrowsecurity
  ) then
    raise exception 'Row-level security must be enabled on all family tables.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'auth.users'::regclass
    and tgname = 'choretracker_create_family_profile' and tgenabled in ('O', 'A'))
    or not exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.profiles'::regclass
    and tgname = 'choretracker_guard_profiles' and tgenabled in ('O', 'A')) then
    raise exception 'The invitation and profile protection triggers must be installed and enabled first.';
  end if;
end;
$$;

-- These helpers return only the current authenticated caller's membership.
-- The schema is not exposed through PostgREST; usage is needed for RLS evaluation.
grant usage on schema choretracker_private to authenticated;
create or replace function choretracker_private.current_family()
returns text language sql stable security definer set search_path = '' as $$
  select p.family_code from public.profiles p where p.id = auth.uid()
$$;
create or replace function choretracker_private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;
revoke all on function choretracker_private.current_family() from public, anon;
revoke all on function choretracker_private.current_role() from public, anon;
grant execute on function choretracker_private.current_family() to authenticated;
grant execute on function choretracker_private.current_role() to authenticated;
revoke all on function choretracker_private.choretracker_create_profile() from public, anon, authenticated;
revoke all on function choretracker_private.choretracker_guard_profiles() from public, anon, authenticated;

revoke all on public.profiles, public.chores, public.chore_templates, public.rewards, public.redemptions from public, anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles, public.chores, public.chore_templates, public.rewards, public.redemptions to authenticated;
grant insert, update on public.chores, public.chore_templates, public.redemptions to authenticated;
grant insert on public.rewards to authenticated;
revoke delete on public.chores, public.chore_templates, public.rewards, public.redemptions from authenticated;
revoke update on public.rewards from authenticated;

-- Only the explicit audited testing policies are removed.
drop policy if exists "Public profiles for testing" on public.profiles;
drop policy if exists "Public access for testing" on public.chores;
drop policy if exists "Public chore_templates for testing" on public.chore_templates;
drop policy if exists "Public rewards for testing" on public.rewards;
drop policy if exists "Public redemptions for testing" on public.redemptions;

drop policy if exists ct_profiles_read on public.profiles;
create policy ct_profiles_read on public.profiles for select to authenticated
  using (family_code = (select choretracker_private.current_family()));

drop policy if exists ct_chores_read on public.chores;
create policy ct_chores_read on public.chores for select to authenticated using (
  family_code = (select choretracker_private.current_family()) and
  ((select choretracker_private.current_role()) = 'parent' or assigned_to_id = (select auth.uid()))
);
drop policy if exists ct_chores_insert on public.chores;
create policy ct_chores_insert on public.chores for insert to authenticated with check (
  family_code = (select choretracker_private.current_family()) and (select choretracker_private.current_role()) = 'parent'
  and exists (select 1 from public.profiles p where p.id = assigned_to_id and p.family_code = chores.family_code and p.role = 'kid')
);
drop policy if exists ct_chores_update on public.chores;
create policy ct_chores_update on public.chores for update to authenticated using (
  family_code = (select choretracker_private.current_family()) and
  ((select choretracker_private.current_role()) = 'parent' or (assigned_to_id = (select auth.uid()) and (select choretracker_private.current_role()) = 'kid'))
) with check (
  family_code = (select choretracker_private.current_family()) and
  ((select choretracker_private.current_role()) = 'parent' or (assigned_to_id = (select auth.uid()) and (select choretracker_private.current_role()) = 'kid'))
);

-- A row policy alone cannot stop a child from changing points or approving a chore.
create or replace function choretracker_private.guard_kid_chore_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select choretracker_private.current_role()) = 'kid' then
    if (pg_catalog.to_jsonb(new) - array['status','is_completed','before_photo_url','after_photo_url'])
       is distinct from (pg_catalog.to_jsonb(old) - array['status','is_completed','before_photo_url','after_photo_url'])
       or not (
         (coalesce(old.status, 'pending') = 'pending' and new.status = 'submitted' and new.is_completed = true)
         or (old.status = 'submitted' and new.status = 'pending' and new.is_completed = false)
         or (new.status is not distinct from old.status and new.is_completed is not distinct from old.is_completed
             and coalesce(old.status, 'pending') in ('pending', 'submitted'))
       ) then
      raise exception 'Children may only submit, undo, or add photos to their own chores' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function choretracker_private.guard_kid_chore_update() from public, anon, authenticated;
drop trigger if exists ct_guard_kid_chore_update on public.chores;
create trigger ct_guard_kid_chore_update before update on public.chores
  for each row execute function choretracker_private.guard_kid_chore_update();

drop policy if exists ct_templates_read on public.chore_templates;
create policy ct_templates_read on public.chore_templates for select to authenticated using (family_code = (select choretracker_private.current_family()));
drop policy if exists ct_templates_insert on public.chore_templates;
create policy ct_templates_insert on public.chore_templates for insert to authenticated with check (family_code = (select choretracker_private.current_family()) and (select choretracker_private.current_role()) = 'parent');
drop policy if exists ct_templates_update on public.chore_templates;
create policy ct_templates_update on public.chore_templates for update to authenticated using (family_code = (select choretracker_private.current_family()) and (select choretracker_private.current_role()) = 'parent') with check (family_code = (select choretracker_private.current_family()) and (select choretracker_private.current_role()) = 'parent');

drop policy if exists ct_rewards_read on public.rewards;
create policy ct_rewards_read on public.rewards for select to authenticated using (family_code = (select choretracker_private.current_family()));
drop policy if exists ct_rewards_insert on public.rewards;
create policy ct_rewards_insert on public.rewards for insert to authenticated with check (family_code = (select choretracker_private.current_family()) and (select choretracker_private.current_role()) = 'parent');

drop policy if exists ct_redemptions_read on public.redemptions;
create policy ct_redemptions_read on public.redemptions for select to authenticated using (
  family_code = (select choretracker_private.current_family()) and
  ((select choretracker_private.current_role()) = 'parent' or kid_id = (select auth.uid()))
);
drop policy if exists ct_redemptions_insert on public.redemptions;
create policy ct_redemptions_insert on public.redemptions for insert to authenticated with check (
  family_code = (select choretracker_private.current_family()) and kid_id = (select auth.uid()) and (select choretracker_private.current_role()) = 'kid'
);
drop policy if exists ct_redemptions_update on public.redemptions;
create policy ct_redemptions_update on public.redemptions for update to authenticated using (family_code = (select choretracker_private.current_family()) and (select choretracker_private.current_role()) = 'parent') with check (family_code = (select choretracker_private.current_family()) and (select choretracker_private.current_role()) = 'parent');

-- Validate the prize, balance and submitted identity on the server. Lock per
-- child so concurrent redemptions cannot spend the same points twice.
create or replace function choretracker_private.validate_redemption()
returns trigger language plpgsql security definer set search_path = '' as $$
declare earned bigint; spent bigint; caller_name text;
begin
  if auth.uid() is null or new.kid_id is distinct from auth.uid()
    or new.family_code is distinct from (select choretracker_private.current_family())
    or (select choretracker_private.current_role()) is distinct from 'kid' then
    raise exception 'Only a child can redeem their own reward' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text, 0));
  select p.full_name into caller_name from public.profiles p where p.id = auth.uid();
  if new.kid_name is distinct from caller_name or new.status is distinct from 'pending'
    or new.points_spent is null or new.points_spent < 0 or not exists (
      select 1 from public.rewards r where r.family_code = new.family_code
        and r.title = new.reward_title and r.point_cost = new.points_spent and r.point_cost >= 0
    ) then
    raise exception 'Invalid reward or redemption';
  end if;
  select coalesce(sum(c.points), 0) into earned from public.chores c
    where c.family_code = new.family_code and c.assigned_to_id = auth.uid() and c.status = 'approved';
  select coalesce(sum(r.points_spent), 0) into spent from public.redemptions r
    where r.family_code = new.family_code and r.kid_id = auth.uid();
  if new.points_spent > greatest(earned - spent, 0) then raise exception 'Not enough points'; end if;
  return new;
end;
$$;
revoke all on function choretracker_private.validate_redemption() from public, anon, authenticated;
drop trigger if exists ct_validate_redemption on public.redemptions;
create trigger ct_validate_redemption before insert on public.redemptions
  for each row execute function choretracker_private.validate_redemption();

-- Return family aggregates without granting children access to siblings' rows.
-- The caller's family is derived from auth.uid(), never from a client argument.
create or replace function public.get_family_child_stats()
returns table (child_id uuid, child_name text, completed_chores bigint, points_earned bigint, points_spent bigint, points_available bigint)
language plpgsql stable security definer set search_path = '' as $$
declare caller_family text; caller_role text;
begin
  select p.family_code, p.role into caller_family, caller_role from public.profiles p where p.id = auth.uid();
  if caller_family is null or caller_family = '' or caller_role is null or caller_role not in ('parent', 'kid') then
    raise exception 'A family profile is required' using errcode = '42501';
  end if;
  return query select child.id, child.full_name::text,
    coalesce(c.completed, 0)::bigint, coalesce(c.earned, 0)::bigint,
    case when caller_role = 'parent' then coalesce(r.spent, 0)::bigint else null::bigint end,
    case when caller_role = 'parent' then greatest(coalesce(c.earned, 0) - coalesce(r.spent, 0), 0)::bigint else null::bigint end
  from public.profiles child
  left join lateral (select count(*) as completed, coalesce(sum(ch.points), 0) as earned from public.chores ch
    where ch.family_code = caller_family and ch.assigned_to_id = child.id and ch.status = 'approved') c on true
  left join lateral (select coalesce(sum(rd.points_spent), 0) as spent from public.redemptions rd
    where rd.family_code = caller_family and rd.kid_id = child.id) r on true
  where child.family_code = caller_family and child.role = 'kid';
end;
$$;
revoke all on function public.get_family_child_stats() from public, anon;
grant execute on function public.get_family_child_stats() to authenticated;

commit;
