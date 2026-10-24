begin;

do $preflight$
declare
  system_identifier text := (
    select control.system_identifier::text
    from pg_catalog.pg_control_system() control
  );
begin
  if pg_catalog.current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or system_identifier not in (
      '7692131729119822239',
      '7623125441096521075'
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Unapproved database identity.';
  end if;

  if pg_catalog.to_regclass(
       'repair_image_private.repair_image_objects'
     ) is null
    or pg_catalog.to_regclass(
       'repair_image_private.repair_image_object_references'
     ) is null
    or pg_catalog.to_regclass('storage.objects') is null
    or pg_catalog.to_regprocedure(
       'public.claim_repair_image_deletions(integer)'
     ) is null
    or pg_catalog.to_regprocedure(
       'public.complete_repair_image_deletion(text,uuid,boolean)'
     ) is null
  then
    raise exception using
      errcode = '55000',
      message = 'Repair image cleanup prerequisites are missing.';
  end if;

  if pg_catalog.to_regprocedure(
       'public.revalidate_repair_image_deletion_claim(text,uuid)'
     ) is not null
  then
    raise exception using
      errcode = '55000',
      message = 'Repair image deletion claim revalidation already exists.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = pg_catalog.to_regclass(
            'repair_image_private.repair_image_objects'
          )
      and attribute.attname = 'owner_user_id'
      and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
      and attribute.attnotnull
      and not attribute.attisdropped
  )
    or not exists (
      select 1
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = pg_catalog.to_regclass('storage.objects')
        and attribute.attname = 'owner_id'
        and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text'
        and not attribute.attisdropped
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Repair image cleanup ownership contract mismatch.';
  end if;
end;
$preflight$;

create function public.revalidate_repair_image_deletion_claim(
  p_object_path text,
  p_delete_claim_id uuid
)
returns table (
  object_path text,
  delete_claim_id uuid,
  delete_lease_expires_at timestamptz,
  storage_object_exists boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  locked_object repair_image_private.repair_image_objects%rowtype;
  storage_object_count bigint;
  storage_owner_id text;
  renewed_lease_expires_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;

  if p_object_path is null
    or p_delete_claim_id is null
    or p_object_path !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]*$'
    or pg_catalog.char_length(p_object_path) > 1024
    or pg_catalog.strpos(p_object_path, '//') <> 0
    or pg_catalog.strpos(p_object_path, pg_catalog.chr(92)) <> 0
    or pg_catalog.strpos(p_object_path, '?') <> 0
    or pg_catalog.strpos(p_object_path, '#') <> 0
    or pg_catalog.strpos(p_object_path, '%') <> 0
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid repair image deletion claim arguments.';
  end if;

  select registry.*
  into locked_object
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = 'repair-images'
    and registry.object_path = p_object_path
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Repair image deletion claim was not found.';
  end if;

  if locked_object.lifecycle_state is distinct from 'delete_claimed'
    or locked_object.delete_claim_id is distinct from p_delete_claim_id
  then
    raise exception using
      errcode = '40001',
      message = 'Repair image deletion claim is no longer current.';
  end if;

  if locked_object.delete_lease_expires_at is null
    or locked_object.delete_lease_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using
      errcode = '55000',
      message = 'Repair image deletion claim lease has expired.';
  end if;

  if locked_object.owner_user_id is null
    or pg_catalog.lower(pg_catalog.split_part(locked_object.object_path, '/', 1))
       is distinct from pg_catalog.lower(locked_object.owner_user_id::text)
  then
    raise exception using
      errcode = '23514',
      message = 'Repair image deletion claim owner is invalid.';
  end if;

  if exists (
    select 1
    from repair_image_private.repair_image_object_references reference
    where reference.bucket_id = 'repair-images'
      and reference.object_path = p_object_path
  )
  then
    raise exception using
      errcode = '23514',
      message = 'Referenced repair image cannot be revalidated for deletion.';
  end if;

  select pg_catalog.count(*), pg_catalog.min(storage_object.owner_id)
  into storage_object_count, storage_owner_id
  from storage.objects storage_object
  where storage_object.bucket_id = 'repair-images'
    and storage_object.name = p_object_path;

  if storage_object_count > 1
  then
    raise exception using
      errcode = '55000',
      message = 'Repair image Storage identity is not unique.';
  end if;

  if storage_object_count = 1
    and storage_owner_id is distinct from locked_object.owner_user_id::text
  then
    raise exception using
      errcode = '23514',
      message = 'Repair image Storage ownership does not match the registry.';
  end if;

  renewed_lease_expires_at := pg_catalog.clock_timestamp() + interval '5 minutes';

  update repair_image_private.repair_image_objects registry
  set delete_lease_expires_at = renewed_lease_expires_at
  where registry.bucket_id = 'repair-images'
    and registry.object_path = p_object_path
    and registry.lifecycle_state = 'delete_claimed'
    and registry.delete_claim_id = p_delete_claim_id
    and registry.delete_lease_expires_at > pg_catalog.clock_timestamp();

  if not found then
    raise exception using
      errcode = '40001',
      message = 'Repair image deletion claim changed during revalidation.';
  end if;

  return query
  select
    p_object_path,
    p_delete_claim_id,
    renewed_lease_expires_at,
    storage_object_count = 1;
end;
$function$;

alter function public.revalidate_repair_image_deletion_claim(text, uuid)
  owner to postgres;
revoke all on function public.revalidate_repair_image_deletion_claim(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revalidate_repair_image_deletion_claim(text, uuid)
  to service_role;

do $postcheck$
declare
  function_oid oid := pg_catalog.to_regprocedure(
    'public.revalidate_repair_image_deletion_claim(text,uuid)'
  );
begin
  if function_oid is null
    or not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = procedure.proowner
      join pg_catalog.pg_language language
        on language.oid = procedure.prolang
      where procedure.oid = function_oid
        and namespace.nspname = 'public'
        and procedure.proname = 'revalidate_repair_image_deletion_claim'
        and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
          'p_object_path text, p_delete_claim_id uuid'
        and pg_catalog.pg_get_function_result(procedure.oid) =
          'TABLE(object_path text, delete_claim_id uuid, delete_lease_expires_at timestamp with time zone, storage_object_exists boolean)'
        and owner_role.rolname = 'postgres'
        and language.lanname = 'plpgsql'
        and procedure.provolatile = 'v'
        and procedure.prosecdef
        and coalesce(procedure.proconfig, '{}'::text[]) =
          array['search_path=""']::text[]
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.revalidate_repair_image_deletion_claim(text,uuid)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.revalidate_repair_image_deletion_claim(text,uuid)',
      'execute'
    )
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.revalidate_repair_image_deletion_claim(text,uuid)',
      'execute'
    )
    or (
      select pg_catalog.count(*) <> 2
        or not pg_catalog.bool_and(
          privilege.privilege_type = 'EXECUTE'
          and not privilege.is_grantable
          and privilege.grantee in (
            procedure.proowner,
            (select role.oid
             from pg_catalog.pg_roles role
             where role.rolname = 'service_role')
          )
        )
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(procedure.proacl) privilege
      where procedure.oid = function_oid
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Repair image deletion claim revalidation postcheck failed.';
  end if;
end;
$postcheck$;

commit;
