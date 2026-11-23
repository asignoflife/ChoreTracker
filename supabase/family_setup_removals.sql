-- Parents can remove the chores and prizes they added in Family setup.
-- Deleting a chore only removes it from the assign list: every chore already
-- assigned copies its own title and points, and each redemption keeps its own
-- prize title and cost, so past work and spending are unaffected.
-- Apply after family_access.sql; it relies on choretracker_private.
begin;

grant delete on public.chore_templates, public.rewards to authenticated;

drop policy if exists ct_templates_delete on public.chore_templates;
create policy ct_templates_delete on public.chore_templates for delete to authenticated
  using (
    family_code = (select choretracker_private.current_family())
    and (select choretracker_private.current_role()) = 'parent'
  );

drop policy if exists ct_rewards_delete on public.rewards;
create policy ct_rewards_delete on public.rewards for delete to authenticated
  using (
    family_code = (select choretracker_private.current_family())
    and (select choretracker_private.current_role()) = 'parent'
  );

-- Fail loudly rather than shipping a migration that silently did nothing.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'chore_templates' and policyname = 'ct_templates_delete')
    or not exists (select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'rewards' and policyname = 'ct_rewards_delete') then
    raise exception 'The chore and prize removal policies were not created.';
  end if;
  if not pg_catalog.has_table_privilege('authenticated', 'public.chore_templates', 'DELETE')
    or not pg_catalog.has_table_privilege('authenticated', 'public.rewards', 'DELETE') then
    raise exception 'The delete grant is missing, so parents could not remove anything.';
  end if;
  if exists (select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename in ('chore_templates', 'rewards')
        and cmd = 'DELETE' and policyname not in ('ct_templates_delete', 'ct_rewards_delete')) then
    raise exception 'Another delete policy exists on chores or prizes. Review it before removing.';
  end if;
end;
$$;

commit;
