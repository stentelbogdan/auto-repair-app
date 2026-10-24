begin transaction read only;

with target as (
  select
    procedure.oid,
    procedure.proowner,
    owner_role.rolname as owner_name,
    language.lanname as language_name,
    procedure.provolatile,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.proacl,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(procedure.oid) as result_type,
    pg_catalog.md5(procedure.prosrc) as body_md5
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = procedure.proowner
  join pg_catalog.pg_language language
    on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname = 'revalidate_repair_image_deletion_claim'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'p_object_path text, p_delete_claim_id uuid'
), gates as (
  select 'test_identity'::text as gate,
    (select control.system_identifier::text
     from pg_catalog.pg_control_system() control) = '7692131729119822239'
    and (select control.system_identifier::text
         from pg_catalog.pg_control_system() control) <> '7623125441096521075'
    as passed
  union all
  select 'function_count', pg_catalog.count(*) = 1 from target
  union all
  select 'owner_postgres', pg_catalog.bool_and(owner_name = 'postgres') from target
  union all
  select 'language_plpgsql', pg_catalog.bool_and(language_name = 'plpgsql') from target
  union all
  select 'volatile', pg_catalog.bool_and(provolatile = 'v') from target
  union all
  select 'security_definer', pg_catalog.bool_and(prosecdef) from target
  union all
  select 'empty_search_path',
    pg_catalog.bool_and(
      coalesce(proconfig, '{}'::text[]) = array['search_path=""']::text[]
    )
  from target
  union all
  select 'identity_arguments',
    pg_catalog.bool_and(
      identity_arguments = 'p_object_path text, p_delete_claim_id uuid'
    )
  from target
  union all
  select 'result_type',
    pg_catalog.bool_and(
      result_type =
        'TABLE(object_path text, delete_claim_id uuid, delete_lease_expires_at timestamp with time zone, storage_object_exists boolean)'
    )
  from target
  union all
  select 'body_contract',
    pg_catalog.bool_and(
      body_md5 is not null
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(oid),
        'auth.role() is distinct from ''service_role'''
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(oid)),
        'for update'
      ) > 0
    )
  from target
  union all
  select 'direct_acl_exact',
    pg_catalog.count(*) = 2
    and pg_catalog.bool_and(
      privilege.privilege_type = 'EXECUTE'
      and not privilege.is_grantable
      and privilege.grantee in (
        target.proowner,
        (select role.oid from pg_catalog.pg_roles role
         where role.rolname = 'service_role')
      )
    )
  from target
  cross join lateral pg_catalog.aclexplode(target.proacl) privilege
  union all
  select 'public_execute_denied', not exists (
    select 1
    from target
    cross join lateral pg_catalog.aclexplode(target.proacl) privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  )
  union all
  select 'anon_execute_denied', not pg_catalog.has_function_privilege(
    'anon',
    'public.revalidate_repair_image_deletion_claim(text,uuid)',
    'execute'
  )
  union all
  select 'authenticated_execute_denied', not pg_catalog.has_function_privilege(
    'authenticated',
    'public.revalidate_repair_image_deletion_claim(text,uuid)',
    'execute'
  )
  union all
  select 'service_role_execute_allowed', pg_catalog.has_function_privilege(
    'service_role',
    'public.revalidate_repair_image_deletion_claim(text,uuid)',
    'execute'
  )
)
select gate, passed
from gates
order by gate;

rollback;
