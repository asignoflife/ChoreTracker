-- Chores get a due date and time. A chore finished after its due time is
-- approved for half its points instead of the full amount.
-- This is additive: existing chores keep their points and simply have no
-- deadline, so nothing already approved can be reduced after the fact.
-- Apply after family_access.sql; it relies on choretracker_private.
begin;

alter table public.chores add column if not exists due_at timestamptz;
alter table public.chores add column if not exists submitted_at timestamptz;
alter table public.chores add column if not exists base_points integer;

-- The full amount promised when the chore was assigned. Points become the
-- awarded amount once a parent approves, so keep the original for display.
update public.chores set base_points = points where base_points is null;

alter table public.chores drop constraint if exists chores_points_not_negative;
alter table public.chores add constraint chores_points_not_negative
  check (points is null or points >= 0);
alter table public.chores drop constraint if exists chores_base_points_not_negative;
alter table public.chores add constraint chores_base_points_not_negative
  check (base_points is null or base_points >= 0);

-- Timestamps come from the server clock, never from the client, and the
-- awarded amount is derived from them. The child guard trigger runs first
-- (ct_guard_... sorts before ct_prepare_...), so a child still cannot send
-- due_at, submitted_at, points or base_points of their own.
create or replace function choretracker_private.prepare_chore_due()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare full_points integer;
begin
  if tg_op = 'INSERT' then
    new.base_points := coalesce(new.base_points, new.points);
    return new;
  end if;

  full_points := coalesce(old.base_points, old.points, new.points);

  -- Record when the child actually finished, and forget it if they undo.
  if new.status = 'submitted' and coalesce(old.status, 'pending') <> 'submitted' then
    new.submitted_at := now();
  elsif new.status = 'pending' and old.status = 'submitted' then
    new.submitted_at := null;
  else
    new.submitted_at := old.submitted_at;
  end if;

  new.base_points := full_points;

  if new.status = 'approved' and coalesce(old.status, 'pending') <> 'approved' then
    -- Half points are earned by finishing late, not by the parent approving
    -- late, so an on-time submission approved the next day still pays full.
    if new.due_at is not null and coalesce(new.submitted_at, now()) > new.due_at then
      new.points := full_points / 2;
    else
      new.points := full_points;
    end if;
  else
    new.points := old.points;
  end if;

  return new;
end;
$$;
revoke all on function choretracker_private.prepare_chore_due() from public, anon, authenticated;
drop trigger if exists ct_prepare_chore_due on public.chores;
create trigger ct_prepare_chore_due before insert or update on public.chores
  for each row execute function choretracker_private.prepare_chore_due();

drop index if exists public.chores_due_idx;
create index if not exists chores_due_idx on public.chores (family_code, due_at)
  where status in ('pending', 'submitted');

commit;
