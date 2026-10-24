begin;

-- Fail closed when a same-named RPC already exists with a different contract.
do $preflight$
declare
  function_oid oid := pg_catalog.to_regprocedure('public.get_own_profile()');
  expected_result constant text := 'TABLE(id uuid, email text, full_name text, created_at timestamp with time zone, role text[], workshop_name text, workshop_phone text, workshop_address text, workshop_city text, workshop_hours text, workshop_description text, workshop_logo_url text, workshop_gallery_urls text[], workshop_slug text, workshop_specializations text[], display_name text, city text, gdpr_accepted boolean, gdpr_accepted_at timestamp with time zone)';
  expected_body_md5 constant text := '1a1f88e142a40c3226a0d8dd53191214';
  column_contract_matches boolean;
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'get_own_profile migration must run as postgres.';
  end if;

  select pg_catalog.count(*) = 19
    and pg_catalog.bool_and(
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = expected.data_type
    )
  into column_contract_matches
  from (
    values
      ('id', 'uuid'),
      ('email', 'text'),
      ('full_name', 'text'),
      ('created_at', 'timestamp with time zone'),
      ('role', 'text[]'),
      ('workshop_name', 'text'),
      ('workshop_phone', 'text'),
      ('workshop_address', 'text'),
      ('workshop_city', 'text'),
      ('workshop_hours', 'text'),
      ('workshop_description', 'text'),
      ('workshop_logo_url', 'text'),
      ('workshop_gallery_urls', 'text[]'),
      ('workshop_slug', 'text'),
      ('workshop_specializations', 'text[]'),
      ('display_name', 'text'),
      ('city', 'text'),
      ('gdpr_accepted', 'boolean'),
      ('gdpr_accepted_at', 'timestamp with time zone')
  ) as expected(column_name, data_type)
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = pg_catalog.to_regclass('public.profiles')
   and attribute.attname = expected.column_name
   and attribute.attnum > 0
   and not attribute.attisdropped;

  if not coalesce(column_contract_matches, false) then
    raise exception using
      errcode = '55000',
      message = 'public.profiles does not satisfy the get_own_profile column contract.';
  end if;

  if function_oid is not null and not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = procedure.proowner
    join pg_catalog.pg_language as language
      on language.oid = procedure.prolang
    where procedure.oid = function_oid
      and namespace.nspname = 'public'
      and procedure.proname = 'get_own_profile'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
      and pg_catalog.pg_get_function_result(procedure.oid) = expected_result
      and owner_role.rolname = 'postgres'
      and language.lanname = 'plpgsql'
      and procedure.provolatile = 's'
      and procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[]) = array['search_path=""']::text[]
      and pg_catalog.md5(procedure.prosrc) = expected_body_md5
  ) then
    raise exception using
      errcode = '55000',
      message = 'Existing public.get_own_profile() has an incompatible contract.';
  end if;
end;
$preflight$;

create or replace function public.get_own_profile()
returns table (
  id uuid,
  email text,
  full_name text,
  created_at timestamp with time zone,
  role text[],
  workshop_name text,
  workshop_phone text,
  workshop_address text,
  workshop_city text,
  workshop_hours text,
  workshop_description text,
  workshop_logo_url text,
  workshop_gallery_urls text[],
  workshop_slug text,
  workshop_specializations text[],
  display_name text,
  city text,
  gdpr_accepted boolean,
  gdpr_accepted_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  return query
  select
    profile.id,
    profile.email,
    profile.full_name,
    profile.created_at,
    profile.role,
    profile.workshop_name,
    profile.workshop_phone,
    profile.workshop_address,
    profile.workshop_city,
    profile.workshop_hours,
    profile.workshop_description,
    profile.workshop_logo_url,
    profile.workshop_gallery_urls,
    profile.workshop_slug,
    profile.workshop_specializations,
    profile.display_name,
    profile.city,
    profile.gdpr_accepted,
    profile.gdpr_accepted_at
  from public.profiles as profile
  where profile.id = current_user_id;
end;
$function$;

revoke all on function public.get_own_profile()
from public, anon, authenticated, service_role;
grant execute on function public.get_own_profile()
to authenticated;

commit;
