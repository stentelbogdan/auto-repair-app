-- TEST ONLY — TRANSACTIONAL ROLLBACK VALIDATION. DO NOT RUN IN LIVE.
-- Synchronize repair_requests.images with the private image registry and expose
-- a service-role-only deletion queue. Physical deletion remains the worker's
-- responsibility and is performed exclusively through the Storage API.

begin;

do $test_identity$
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
$test_identity$;

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
    raise exception using errcode = '55000', message = 'Unapproved database identity.';
  end if;

  if pg_catalog.to_regclass('public.repair_requests') is null
    or pg_catalog.to_regclass(
      'repair_image_private.repair_image_objects'
    ) is null
    or pg_catalog.to_regclass(
      'repair_image_private.repair_image_object_references'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.extract_repair_image_storage_references(jsonb,text)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.can_upload_reserved_repair_image(text)'
    ) is null
  then
    raise exception using errcode = '55000', message = 'Repair image prerequisites are missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    where function_schema.nspname = 'repair_image_private'
      and function_record.proname = 'enforce_repair_image_object_transition'
      and pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''
      and pg_catalog.md5(function_record.prosrc) =
        '8a5b61453c95f55c5861985e75d47451'
  ) then
    raise exception using errcode = '55000', message = 'Registry transition baseline mismatch.';
  end if;
end;
$preflight$;

-- Hold application writes for the whole migration so no repair request can be
-- inserted or changed after the backfill snapshot but before the sync triggers
-- become active. Lock the registry tables in the same parent-before-reference
-- order used by the runtime functions.
lock table public.repair_requests in share row exclusive mode;
lock table repair_image_private.repair_image_objects in share row exclusive mode;
lock table repair_image_private.repair_image_object_references in share row exclusive mode;

create function repair_image_private.expected_storage_host()
returns text
language sql
stable
parallel safe
set search_path = ''
as $function$
  select case (
    select control.system_identifier::text
    from pg_catalog.pg_control_system() control
  )
    when '7692131729119822239' then 'bstjobvvxxfqqwyjoimx.supabase.co'
    when '7623125441096521075' then 'ouoiykudvcoqbkybkqvs.supabase.co'
    else null
  end;
$function$;

create function repair_image_private.sync_repair_request_images()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  expected_host text := repair_image_private.expected_storage_host();
  request_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  request_owner uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  old_paths text[] := array[]::text[];
  new_paths text[] := array[]::text[];
  path_record record;
begin
  if expected_host is null then
    raise exception using
      errcode = '55000',
      message = 'Repair image synchronization is not configured for this database.';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select coalesce(
      pg_catalog.array_agg(distinct reference.object_path order by reference.object_path),
      array[]::text[]
    )
    into old_paths
    from public.extract_repair_image_storage_references(old.images, expected_host) reference;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select coalesce(
      pg_catalog.array_agg(distinct reference.object_path order by reference.object_path),
      array[]::text[]
    )
    into new_paths
    from public.extract_repair_image_storage_references(new.images, expected_host) reference;
  end if;

  -- All registry locks use one deterministic order. The reference guard uses
  -- the same parent-object-first order for every individual mutation.
  for path_record in
    select path_value
    from (
      select pg_catalog.unnest(old_paths || new_paths) as path_value
    ) paths
    group by path_value
    order by path_value collate "C"
  loop
    perform 1
    from repair_image_private.repair_image_objects registry
    where registry.bucket_id = 'repair-images'
      and registry.object_path = path_record.path_value
    for update;
  end loop;

  if tg_op in ('INSERT', 'UPDATE') and exists (
    select 1
    from pg_catalog.unnest(new_paths) as path_values(path_value)
    left join repair_image_private.repair_image_objects registry
      on registry.bucket_id = 'repair-images'
     and registry.object_path = path_value
    where registry.object_path is null
       or registry.owner_user_id is distinct from request_owner
       or registry.lifecycle_state not in ('uploaded', 'attached')
  ) then
    raise exception using
      errcode = '23514',
      message = 'A repair request may reference only confirmed images owned by its owner.';
  end if;

  delete from repair_image_private.repair_image_object_references reference
  where reference.reference_type = 'repair_request_image'
    and reference.reference_id = request_id
    and not (reference.object_path = any(new_paths));

  if tg_op in ('INSERT', 'UPDATE') then
    insert into repair_image_private.repair_image_object_references (
      bucket_id,
      object_path,
      reference_type,
      reference_id
    )
    select 'repair-images', path_value, 'repair_request_image', request_id
    from pg_catalog.unnest(new_paths) as path_values(path_value)
    on conflict (bucket_id, object_path, reference_type, reference_id)
    do update set last_verified_at = pg_catalog.clock_timestamp();

    update repair_image_private.repair_image_objects registry
    set lifecycle_state = 'attached'
    where registry.bucket_id = 'repair-images'
      and registry.object_path = any(new_paths)
      and registry.lifecycle_state is distinct from 'attached';
  end if;

  -- An intentional detach permanently retires the old path. The file remains
  -- present until a worker obtains a delete claim and Storage confirms removal.
  update repair_image_private.repair_image_objects registry
  set lifecycle_state = 'tombstoned',
      tombstoned_at = pg_catalog.clock_timestamp(),
      tombstone_reason = case
        when tg_op = 'DELETE' then 'repair_request_deleted'
        else 'repair_request_image_removed'
      end
  where registry.bucket_id = 'repair-images'
    and registry.object_path = any(old_paths)
    and registry.lifecycle_state in ('uploaded', 'attached')
    and not exists (
      select 1
      from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = registry.bucket_id
        and reference.object_path = registry.object_path
    );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

-- Establish the complete active-reference baseline before enabling runtime
-- synchronization. Any missing Storage object or ownership mismatch aborts the
-- migration instead of silently accepting an unsafe reference.
do $backfill$
declare
  expected_host text := repair_image_private.expected_storage_host();
begin
  if expected_host is null then
    raise exception using errcode = '55000', message = 'Unknown database identity.';
  end if;

  if exists (
    select 1
    from public.repair_requests request
    cross join lateral public.extract_repair_image_storage_references(
      request.images,
      expected_host
    ) reference
    left join storage.objects storage_object
      on storage_object.bucket_id = 'repair-images'
     and storage_object.name = reference.object_path
    where storage_object.id is null
       or storage_object.owner_id is distinct from request.user_id::text
  ) then
    raise exception using
      errcode = '23514',
      message = 'Repair image backfill found a missing object or ownership mismatch.';
  end if;

  insert into repair_image_private.repair_image_objects (
    bucket_id,
    object_path,
    owner_user_id,
    lifecycle_state,
    origin,
    uploaded_at,
    last_observed_at
  )
  select distinct
    'repair-images',
    reference.object_path,
    request.user_id,
    'discovered',
    'legacy_import',
    storage_object.created_at,
    pg_catalog.clock_timestamp()
  from public.repair_requests request
  cross join lateral public.extract_repair_image_storage_references(
    request.images,
    expected_host
  ) reference
  join storage.objects storage_object
    on storage_object.bucket_id = 'repair-images'
   and storage_object.name = reference.object_path
  on conflict (bucket_id, object_path) do nothing;

  if exists (
    select 1
    from public.repair_requests request
    cross join lateral public.extract_repair_image_storage_references(
      request.images,
      expected_host
    ) reference
    join repair_image_private.repair_image_objects registry
      on registry.bucket_id = 'repair-images'
     and registry.object_path = reference.object_path
    where registry.owner_user_id is distinct from request.user_id
  ) then
    raise exception using errcode = '23514', message = 'Registry ownership conflicts with repair requests.';
  end if;

  insert into repair_image_private.repair_image_object_references (
    bucket_id,
    object_path,
    reference_type,
    reference_id
  )
  select distinct
    'repair-images',
    reference.object_path,
    'repair_request_image',
    request.id
  from public.repair_requests request
  cross join lateral public.extract_repair_image_storage_references(
    request.images,
    expected_host
  ) reference
  on conflict (bucket_id, object_path, reference_type, reference_id)
  do update set last_verified_at = pg_catalog.clock_timestamp();

  update repair_image_private.repair_image_objects registry
  set lifecycle_state = 'attached'
  where exists (
    select 1
    from repair_image_private.repair_image_object_references reference
    where reference.bucket_id = registry.bucket_id
      and reference.object_path = registry.object_path
  )
    and registry.lifecycle_state in ('discovered', 'uploaded', 'orphan_candidate');
end;
$backfill$;

create trigger sync_repair_request_images_after_insert
after insert on public.repair_requests
for each row execute function repair_image_private.sync_repair_request_images();

create trigger sync_repair_request_images_after_update
after update of images on public.repair_requests
for each row execute function repair_image_private.sync_repair_request_images();

create trigger sync_repair_request_images_after_delete
after delete on public.repair_requests
for each row execute function repair_image_private.sync_repair_request_images();

create or replace function repair_image_private.enforce_repair_image_object_transition()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  transition_allowed boolean;
begin
  if old.lifecycle_state = 'deleted' then
    raise exception using
      errcode = '23514',
      message = 'A deleted repair image registry row is immutable.';
  end if;

  if new.bucket_id is distinct from old.bucket_id
    or new.object_path is distinct from old.object_path
    or new.owner_user_id is distinct from old.owner_user_id
    or new.origin is distinct from old.origin
    or new.first_observed_at is distinct from old.first_observed_at
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '23514',
      message = 'Repair image registry identity is immutable.';
  end if;

  transition_allowed := case old.lifecycle_state
    when 'discovered' then
      new.lifecycle_state in (
        'discovered',
        'uploaded',
        'attached',
        'orphan_candidate',
        'quarantined'
      )
    when 'reserved' then
      new.lifecycle_state in ('reserved', 'uploaded', 'tombstoned', 'quarantined')
    when 'uploaded' then
      new.lifecycle_state in (
        'uploaded',
        'attached',
        'orphan_candidate',
        'tombstoned',
        'quarantined'
      )
    when 'attached' then
      new.lifecycle_state in (
        'attached',
        'orphan_candidate',
        'tombstoned',
        'quarantined'
      )
    when 'orphan_candidate' then
      new.lifecycle_state in (
        'orphan_candidate',
        'attached',
        'tombstoned',
        'quarantined'
      )
    when 'tombstoned' then
      new.lifecycle_state in ('tombstoned', 'delete_claimed', 'quarantined')
    when 'delete_claimed' then
      new.lifecycle_state in (
        'delete_claimed',
        'tombstoned',
        'deleted',
        'quarantined'
      )
    when 'deleted' then
      new.lifecycle_state = 'deleted'
    when 'quarantined' then
      new.lifecycle_state = 'quarantined'
    else false
  end;

  if transition_allowed is distinct from true then
    raise exception using
      errcode = '23514',
      message = 'Repair image registry state transition is not allowed.';
  end if;

  if new.lifecycle_state in (
    'orphan_candidate',
    'tombstoned',
    'delete_claimed',
    'deleted'
  )
    and exists (
      select 1
      from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = old.bucket_id
        and reference.object_path = old.object_path
    )
  then
    raise exception using
      errcode = '23514',
      message = 'A referenced repair image cannot enter an unreferenced or deletion state.';
  end if;

  if new.lifecycle_state = 'attached'
    and not exists (
      select 1
      from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = old.bucket_id
        and reference.object_path = old.object_path
    )
  then
    raise exception using
      errcode = '23514',
      message = 'An attached repair image must have an active reference.';
  end if;

  new.row_version := old.row_version + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;


create function public.claim_repair_image_deletions(p_limit integer default 25)
returns table (object_path text, delete_claim_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;

  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'Invalid cleanup batch size.';
  end if;

  -- Release expired claims for retry. No deletion request is ever forgotten.
  update repair_image_private.repair_image_objects registry
  set lifecycle_state = 'tombstoned',
      delete_claim_id = null,
      delete_lease_expires_at = null
  where registry.lifecycle_state = 'delete_claimed'
    and registry.delete_lease_expires_at <= pg_catalog.clock_timestamp();

  -- Uploads that never became references receive a safety window after the
  -- upload lease. Reserved objects may not exist in Storage; deleting a missing
  -- object is treated as an idempotent success by the worker.
  update repair_image_private.repair_image_objects registry
  set lifecycle_state = 'tombstoned',
      upload_lease_id = null,
      upload_lease_expires_at = null,
      tombstoned_at = pg_catalog.clock_timestamp(),
      tombstone_reason = 'abandoned_upload'
  where registry.lifecycle_state = 'reserved'
    and registry.upload_lease_expires_at <= pg_catalog.clock_timestamp() - interval '1 hour'
    and not exists (
      select 1 from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = registry.bucket_id
        and reference.object_path = registry.object_path
    );

  update repair_image_private.repair_image_objects registry
  set lifecycle_state = 'tombstoned',
      tombstoned_at = pg_catalog.clock_timestamp(),
      tombstone_reason = 'unattached_upload'
  where registry.lifecycle_state = 'uploaded'
    and registry.uploaded_at <= pg_catalog.clock_timestamp() - interval '1 hour'
    and not exists (
      select 1 from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = registry.bucket_id
        and reference.object_path = registry.object_path
    );

  return query
  with candidates as (
    select registry.bucket_id, registry.object_path
    from repair_image_private.repair_image_objects registry
    where registry.lifecycle_state = 'tombstoned'
      and not exists (
        select 1 from repair_image_private.repair_image_object_references reference
        where reference.bucket_id = registry.bucket_id
          and reference.object_path = registry.object_path
    )
    order by registry.tombstoned_at, registry.object_path collate "C"
    limit p_limit
    for update skip locked
  ), claimed as (
    update repair_image_private.repair_image_objects registry
    set lifecycle_state = 'delete_claimed',
        delete_claim_id = pg_catalog.gen_random_uuid(),
        delete_lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes'
    from candidates
    where registry.bucket_id = candidates.bucket_id
      and registry.object_path = candidates.object_path
    returning registry.object_path, registry.delete_claim_id
  )
  select claimed.object_path, claimed.delete_claim_id from claimed;
end;
$function$;

create function public.complete_repair_image_deletion(
  p_object_path text,
  p_delete_claim_id uuid,
  p_deleted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required.';
  end if;

  if p_deleted then
    update repair_image_private.repair_image_objects registry
    set lifecycle_state = 'deleted',
        delete_claim_id = null,
        delete_lease_expires_at = null,
        deleted_at = pg_catalog.clock_timestamp()
    where registry.bucket_id = 'repair-images'
      and registry.object_path = p_object_path
      and registry.lifecycle_state = 'delete_claimed'
      and registry.delete_claim_id = p_delete_claim_id;
  else
    update repair_image_private.repair_image_objects registry
    set lifecycle_state = 'tombstoned',
        delete_claim_id = null,
        delete_lease_expires_at = null
    where registry.bucket_id = 'repair-images'
      and registry.object_path = p_object_path
      and registry.lifecycle_state = 'delete_claimed'
      and registry.delete_claim_id = p_delete_claim_id;
  end if;

  if not found then
    raise exception using errcode = '40001', message = 'Delete claim is no longer current.';
  end if;
end;
$function$;

alter function repair_image_private.expected_storage_host() owner to postgres;
alter function repair_image_private.sync_repair_request_images() owner to postgres;
alter function repair_image_private.enforce_repair_image_reference_consistency()
  owner to postgres;
alter function repair_image_private.enforce_repair_image_reference_consistency()
  security definer;
alter function public.claim_repair_image_deletions(integer) owner to postgres;
alter function public.complete_repair_image_deletion(text, uuid, boolean) owner to postgres;

revoke all on function repair_image_private.expected_storage_host()
  from public, anon, authenticated, service_role;
revoke all on function repair_image_private.sync_repair_request_images()
  from public, anon, authenticated, service_role;
revoke all on function
  repair_image_private.enforce_repair_image_reference_consistency()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_repair_image_deletions(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_repair_image_deletion(text, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_repair_image_deletions(integer) to service_role;
grant execute on function public.complete_repair_image_deletion(text, uuid, boolean) to service_role;

drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Authenticated users can upload own repair images" on storage.objects;
drop policy if exists "Authenticated users can delete own repair images" on storage.objects;

create policy "Authenticated users can upload reserved repair images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'repair-images'
  and public.can_upload_reserved_repair_image(name)
);

do $postcheck$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    where function_schema.nspname = 'repair_image_private'
      and function_record.proname =
        'enforce_repair_image_reference_consistency'
      and pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''
      and pg_catalog.pg_get_userbyid(function_record.proowner) = 'postgres'
      and function_record.prosecdef
      and function_record.proconfig = array['search_path=""']
      and not exists (
        select 1
        from pg_catalog.aclexplode(function_record.proacl) acl
        where acl.grantee <> function_record.proowner
      )
  )
    or pg_catalog.has_schema_privilege(
      'service_role', 'repair_image_private', 'USAGE'
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Repair image deferred trigger security check failed.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.repair_requests'::pg_catalog.regclass
      and trigger_record.tgname in (
        'sync_repair_request_images_after_insert',
        'sync_repair_request_images_after_update',
        'sync_repair_request_images_after_delete'
      )
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled = 'O'
  ) is distinct from 3::bigint then
    raise exception using errcode = '55000', message = 'Repair image synchronization trigger check failed.';
  end if;

  if not pg_catalog.has_function_privilege(
      'service_role',
      'public.claim_repair_image_deletions(integer)',
      'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role',
      'public.complete_repair_image_deletion(text,uuid,boolean)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'public.claim_repair_image_deletions(integer)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.complete_repair_image_deletion(text,uuid,boolean)',
      'EXECUTE'
    )
  then
    raise exception using errcode = '55000', message = 'Repair image cleanup ACL check failed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policy policy_record
    where policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
      and policy_record.polname = 'Authenticated users can upload reserved repair images'
      and policy_record.polcmd = 'a'
  ) or exists (
    select 1
    from pg_catalog.pg_policy policy_record
    where policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
      and policy_record.polname = 'Authenticated users can delete own repair images'
  ) or exists (
    select 1
    from pg_catalog.pg_policy policy_record
    where policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
      and policy_record.polcmd in ('*', 'd')
      and exists (
        select 1
        from pg_catalog.unnest(policy_record.polroles) policy_role(role_oid)
        where case
          when policy_role.role_oid = 0::oid then true
          else
            pg_catalog.pg_has_role(
              'authenticated', policy_role.role_oid, 'MEMBER'
            )
            or pg_catalog.pg_has_role('anon', policy_role.role_oid, 'MEMBER')
        end
      )
  ) then
    raise exception using errcode = '55000', message = 'Repair image Storage policy check failed.';
  end if;
end;
$postcheck$;

rollback;
