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
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner_role
    on owner_role.oid = procedure.proowner
  join pg_catalog.pg_language as language
    on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname = 'get_own_profile'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
), expected_result as (
  select 'TABLE(id uuid, email text, full_name text, created_at timestamp with time zone, role text[], workshop_name text, workshop_phone text, workshop_address text, workshop_city text, workshop_hours text, workshop_description text, workshop_logo_url text, workshop_gallery_urls text[], workshop_slug text, workshop_specializations text[], display_name text, city text, gdpr_accepted boolean, gdpr_accepted_at timestamp with time zone)'::text as value
), gates as (
  select 'function_count'::text as gate, pg_catalog.count(*) = 1 as passed
  from target
  union all
  select 'owner_postgres', pg_catalog.bool_and(owner_name = 'postgres') from target
  union all
  select 'no_arguments', pg_catalog.bool_and(identity_arguments = '') from target
  union all
  select 'return_type', pg_catalog.bool_and(result_type = expected_result.value)
  from target cross join expected_result
  union all
  select 'language_plpgsql', pg_catalog.bool_and(language_name = 'plpgsql') from target
  union all
  select 'stable', pg_catalog.bool_and(provolatile = 's') from target
  union all
  select 'security_definer', pg_catalog.bool_and(prosecdef) from target
  union all
  select 'empty_search_path', pg_catalog.bool_and(coalesce(proconfig, '{}'::text[]) = array['search_path=""']::text[]) from target
  union all
  select 'body_hash', pg_catalog.bool_and(body_md5 = '1a1f88e142a40c3226a0d8dd53191214') from target
  union all
  select 'direct_acl_exact',
    pg_catalog.count(*) = 2
    and pg_catalog.bool_and(
      privilege.privilege_type = 'EXECUTE'
      and privilege.grantee in (
        target.proowner,
        (select role.oid from pg_catalog.pg_roles as role where role.rolname = 'authenticated')
      )
    )
  from target
  cross join lateral pg_catalog.aclexplode(target.proacl) as privilege
  union all
  select 'public_execute_denied', not exists (
    select 1
    from target
    cross join lateral pg_catalog.aclexplode(target.proacl) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  )
  union all
  select 'anon_execute_denied', not pg_catalog.has_function_privilege('anon', 'public.get_own_profile()', 'execute')
  union all
  select 'authenticated_execute_allowed', pg_catalog.has_function_privilege('authenticated', 'public.get_own_profile()', 'execute')
  union all
  select 'service_role_execute_denied', not pg_catalog.has_function_privilege('service_role', 'public.get_own_profile()', 'execute')
)
select gate, passed
from gates
order by gate;

rollback;
