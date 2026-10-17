begin read only;

do $identity$
begin
  if pg_catalog.current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or (
      select control.system_identifier::text
      from pg_catalog.pg_control_system() control
    ) is distinct from '7692131729119822239'
  then
    raise exception using
      errcode = '55000',
      message = 'Expected isolated TEST database identity.';
  end if;
end;
$identity$;

with checks as (
  select
    1 as check_number,
    'identity'::text as check_name,
    'PASS'::text as status,
    (
      select control.system_identifier::text
      from pg_catalog.pg_control_system() control
    ) as observed,
    '7692131729119822239'::text as expected

  union all
  select
    2,
    'new_public_functions_absent',
    case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
    pg_catalog.count(*)::text,
    '0'
  from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace function_schema
    on function_schema.oid = function_record.pronamespace
  where function_schema.nspname = 'public'
    and function_record.proname in (
      'claim_repair_image_deletions',
      'complete_repair_image_deletion'
    )

  union all
  select
    3,
    'new_private_functions_absent',
    case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
    pg_catalog.count(*)::text,
    '0'
  from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace function_schema
    on function_schema.oid = function_record.pronamespace
  where function_schema.nspname = 'repair_image_private'
    and function_record.proname in (
      'expected_storage_host',
      'sync_repair_request_images'
    )

  union all
  select
    4,
    'new_request_triggers_absent',
    case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
    pg_catalog.count(*)::text,
    '0'
  from pg_catalog.pg_trigger trigger_record
  where trigger_record.tgrelid =
      pg_catalog.to_regclass('public.repair_requests')
    and trigger_record.tgname in (
      'sync_repair_request_images_after_insert',
      'sync_repair_request_images_after_update',
      'sync_repair_request_images_after_delete'
    )

  union all
  select
    5,
    'registry_transition_baseline',
    case
      when pg_catalog.count(*) = 1
       and pg_catalog.min(pg_catalog.md5(function_record.prosrc)) =
         '8a5b61453c95f55c5861985e75d47451'
      then 'PASS' else 'FAIL'
    end,
    coalesce(pg_catalog.min(pg_catalog.md5(function_record.prosrc)), 'MISSING'),
    '8a5b61453c95f55c5861985e75d47451'
  from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace function_schema
    on function_schema.oid = function_record.pronamespace
  where function_schema.nspname = 'repair_image_private'
    and function_record.proname = 'enforce_repair_image_object_transition'
    and pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''

  union all
  select
    6,
    'reserved_upload_policy_absent',
    case when pg_catalog.count(*) = 0 then 'PASS' else 'FAIL' end,
    pg_catalog.count(*)::text,
    '0'
  from pg_catalog.pg_policy policy_record
  where policy_record.polrelid = pg_catalog.to_regclass('storage.objects')
    and policy_record.polname =
      'Authenticated users can upload reserved repair images'

  union all
  select
    7,
    'storage_policy_snapshot',
    'SNAPSHOT',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(
      policy_record.polname || '|' || policy_record.polcmd::text || '|' ||
      coalesce(pg_catalog.pg_get_expr(
        policy_record.polqual,
        policy_record.polrelid
      ), '') || '|' || coalesce(pg_catalog.pg_get_expr(
        policy_record.polwithcheck,
        policy_record.polrelid
      ), ''),
      E'\n' order by policy_record.polname collate "C"
    ), '')),
    'must match the pre-validation snapshot'
  from pg_catalog.pg_policy policy_record
  where policy_record.polrelid = pg_catalog.to_regclass('storage.objects')

  union all
  select
    8,
    'registry_state_snapshot',
    'SNAPSHOT',
    pg_catalog.md5(coalesce(pg_catalog.string_agg(
      state_counts.lifecycle_state || ':' || state_counts.row_count::text,
      E'\n' order by state_counts.lifecycle_state collate "C"
    ), '')),
    'must match the pre-validation snapshot'
  from (
    select registry.lifecycle_state, pg_catalog.count(*) as row_count
    from repair_image_private.repair_image_objects registry
    group by registry.lifecycle_state
  ) state_counts
)
select check_number, check_name, status, observed, expected
from checks
order by check_number;

rollback;
