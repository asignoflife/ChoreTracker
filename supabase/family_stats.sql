-- Legacy setup only. Do not apply after family_access.sql: it replaces this
-- function with a family-scoped aggregate needed by the child's leaderboard.
-- This version uses the caller's row-level security policies.
create or replace function public.get_family_child_stats()
returns table (
  child_id uuid,
  child_name text,
  completed_chores bigint,
  points_earned bigint,
  points_spent bigint,
  points_available bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_family text;
  caller_role text;
begin
  select p.family_code, p.role
    into caller_family, caller_role
    from public.profiles p
    where p.id = (select auth.uid());

  if caller_family is null or caller_family = '' or caller_role not in ('parent', 'kid') or caller_role is null then
    raise exception 'A family profile is required' using errcode = '42501';
  end if;

  return query
    select
      child.id,
      child.full_name::text,
      coalesce(chore_totals.completed, 0)::bigint,
      coalesce(chore_totals.earned, 0)::bigint,
      case when caller_role = 'parent' then coalesce(redeemed.spent, 0)::bigint else null::bigint end,
      case when caller_role = 'parent' then greatest(coalesce(chore_totals.earned, 0) - coalesce(redeemed.spent, 0), 0)::bigint else null::bigint end
    from public.profiles child
    left join lateral (
      select count(*) as completed, coalesce(sum(c.points), 0) as earned
      from public.chores c
      where c.family_code = caller_family
        and c.assigned_to_id = child.id
        and c.status = 'approved'
    ) chore_totals on true
    left join lateral (
      select coalesce(sum(r.points_spent), 0) as spent
      from public.redemptions r
      where r.family_code = caller_family and r.kid_id = child.id
    ) redeemed on true
    where child.family_code = caller_family and child.role = 'kid';
end;
$$;

revoke all on function public.get_family_child_stats() from public, anon;
grant execute on function public.get_family_child_stats() to authenticated;
