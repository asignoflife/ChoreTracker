-- Read-only diagnostic. Run in the Supabase SQL Editor for the intended project.
-- It reports schema definitions and permissions, not application table rows.
-- Review the output for secrets before sharing: function definitions can
-- contain hard-coded credentials in some projects.
with relevant_tables as (
  select c.oid, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where (n.nspname = 'public' and c.relname in
    ('profiles', 'chores', 'chore_templates', 'rewards', 'redemptions'))
    or (n.nspname = 'auth' and c.relname = 'users')
), trigger_functions as (
  select distinct t.tgfoid
  from pg_catalog.pg_trigger t
  join relevant_tables r on r.oid = t.tgrelid
  where not t.tgisinternal
), relevant_functions as (
  select p.oid, n.nspname, p.proname
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.oid in (select tgfoid from trigger_functions)
     or (n.nspname in ('public', 'private', 'choretracker_private')
       and p.proname in ('family_signup_version', 'create_family_invitation',
         'get_family_child_stats', 'choretracker_guard_profiles', 'choretracker_create_profile'))
)
select pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'tables', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schema', r.nspname, 'table', r.relname,
      'rls_enabled', r.relrowsecurity, 'rls_forced', r.relforcerowsecurity,
      'owner', pg_catalog.pg_get_userbyid(c.relowner)
    ) order by r.nspname, r.relname)
    from relevant_tables r join pg_catalog.pg_class c on c.oid = r.oid
  ), '[]'::jsonb),
  'public_columns', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', r.relname, 'column', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull,
      'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    ) order by r.relname, a.attnum)
    from relevant_tables r
    join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_catalog.pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
    where r.nspname = 'public'
  ), '[]'::jsonb),
  'public_constraints', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', r.relname, 'name', con.conname,
      'definition', pg_catalog.pg_get_constraintdef(con.oid)
    ) order by r.relname, con.conname)
    from relevant_tables r join pg_catalog.pg_constraint con on con.conrelid = r.oid
    where r.nspname = 'public'
  ), '[]'::jsonb),
  'triggers', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', r.nspname || '.' || r.relname, 'name', t.tgname,
      'enabled', t.tgenabled, 'definition', pg_catalog.pg_get_triggerdef(t.oid),
      'function', t.tgfoid::regprocedure::text
    ) order by r.nspname, r.relname, t.tgname)
    from relevant_tables r join pg_catalog.pg_trigger t on t.tgrelid = r.oid
    where not t.tgisinternal
  ), '[]'::jsonb),
  'functions', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'function', f.oid::regprocedure::text, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef, 'config', p.proconfig,
      'definition', pg_catalog.pg_get_functiondef(p.oid),
      'execute_anon', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      'execute_authenticated', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by f.nspname, f.proname)
    from relevant_functions f join pg_catalog.pg_proc p on p.oid = f.oid
  ), '[]'::jsonb),
  'policies', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', p.tablename, 'name', p.policyname, 'permissive', p.permissive,
      'roles', p.roles, 'command', p.cmd, 'using', p.qual, 'check', p.with_check
    ) order by p.tablename, p.policyname)
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename in
      ('profiles', 'chores', 'chore_templates', 'rewards', 'redemptions')
  ), '[]'::jsonb),
  'table_permissions', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table', r.relname, 'role', role_name,
      'select', pg_catalog.has_table_privilege(role_name, r.oid, 'SELECT'),
      'insert', pg_catalog.has_table_privilege(role_name, r.oid, 'INSERT'),
      'update', pg_catalog.has_table_privilege(role_name, r.oid, 'UPDATE'),
      'delete', pg_catalog.has_table_privilege(role_name, r.oid, 'DELETE')
    ) order by r.relname, role_name)
    from relevant_tables r cross join (values ('anon'), ('authenticated')) as roles(role_name)
    where r.nspname = 'public'
  ), '[]'::jsonb),
  'profile_column_permissions', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'column', a.attname, 'role', role_name,
      'insert', pg_catalog.has_column_privilege(role_name, r.oid, a.attname, 'INSERT'),
      'update', pg_catalog.has_column_privilege(role_name, r.oid, a.attname, 'UPDATE')
    ) order by a.attname, role_name)
    from relevant_tables r
    join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    cross join (values ('anon'), ('authenticated')) as roles(role_name)
    where r.nspname = 'public' and r.relname = 'profiles'
  ), '[]'::jsonb)
)) as family_setup_audit;
