begin;

-- Run only after applying 20261003100000, 20261003110000 and 20261003120000
-- in an isolated Supabase/PostgreSQL database. Every synthetic row is rolled
-- back, including storage.objects metadata; no Storage API is called.
do $tests$
declare
  owner_id constant uuid := '11111111-1111-4111-8111-111111111111';
  other_owner_id constant uuid := '22222222-2222-4222-8222-222222222222';
  reserved_path text;
  reserved_lease_id uuid;
  reserved_expires_at timestamptz;
  abandoned_path text;
  abandoned_lease_id uuid;
  abandoned_expires_at timestamptz;
  observed_lease_id uuid;
  observed_lease_expires_at timestamptz;
  expired_path constant text :=
    '11111111-1111-4111-8111-111111111111/expired-upload-test.jpg';
  expired_lease_id constant uuid :=
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  wrong_owner_path constant text :=
    '11111111-1111-4111-8111-111111111111/wrong-storage-owner.jpg';
  wrong_owner_lease_id constant uuid :=
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  function_result text;
  rejected boolean;
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'repair-images'
  ) then
    raise exception 'Required Storage bucket repair-images does not exist.';
  end if;

  if auth.uid() is not null then
    raise exception 'Upload function tests require an initially unauthenticated session.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    join pg_catalog.pg_roles function_owner
      on function_owner.oid = function_record.proowner
    where function_schema.nspname = 'public'
      and function_record.proname in (
        'reserve_repair_image_upload',
        'can_upload_reserved_repair_image',
        'confirm_repair_image_upload',
        'abandon_repair_image_upload'
      )
      and (
        function_record.prosecdef is distinct from true
        or coalesce(
          pg_catalog.array_length(function_record.proconfig, 1),
          0
        ) is distinct from 1
        or function_record.proconfig[1] not in (
          'search_path=',
          'search_path=""'
        )
        or function_owner.rolname is distinct from 'postgres'
      )
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_record.pronamespace
    where function_schema.nspname = 'public'
      and function_record.proname in (
        'reserve_repair_image_upload',
        'can_upload_reserved_repair_image',
        'confirm_repair_image_upload',
        'abandon_repair_image_upload'
      )
  ) is distinct from 4::bigint then
    raise exception 'Upload function security contract test failed.';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_repair_image_upload(text)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'public.can_upload_reserved_repair_image(text)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'public.confirm_repair_image_upload(text,uuid)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'public.abandon_repair_image_upload(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated upload function privileges are missing.';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.reserve_repair_image_upload(text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.can_upload_reserved_repair_image(text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.confirm_repair_image_upload(text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.abandon_repair_image_upload(text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.reserve_repair_image_upload(text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.confirm_repair_image_upload(text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.can_upload_reserved_repair_image(text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'service_role',
    'public.abandon_repair_image_upload(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Upload functions expose unexpected privileges.';
  end if;

  rejected := false;
  begin
    perform public.reserve_repair_image_upload('jpg');
  exception
    when sqlstate '42501' then rejected := true;
  end;
  if not rejected then
    raise exception 'Unauthenticated reservation test failed.';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    owner_id::text,
    true
  );

  rejected := false;
  begin
    perform public.reserve_repair_image_upload('gif');
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Invalid extension rejection test failed.';
  end if;

  select
    reservation.object_path,
    reservation.upload_lease_id,
    reservation.upload_lease_expires_at
  into
    reserved_path,
    reserved_lease_id,
    reserved_expires_at
  from public.reserve_repair_image_upload('JPG') reservation;

  if reserved_path !~ (
    '^' || owner_id::text || '/[0-9a-f-]{36}[.]jpg$'
  ) or reserved_lease_id is null
    or reserved_expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception 'Server-generated reservation contract test failed.';
  end if;

  if public.can_upload_reserved_repair_image(reserved_path)
    is distinct from true
  then
    raise exception 'Live reservation authorization test failed.';
  end if;

  rejected := false;
  begin
    perform public.confirm_repair_image_upload(
      reserved_path,
      reserved_lease_id
    );
  exception
    when sqlstate '55000' then rejected := true;
  end;
  if not rejected then
    raise exception 'Missing Storage object confirmation test failed.';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    other_owner_id::text,
    true
  );

  if public.can_upload_reserved_repair_image(reserved_path)
    is distinct from false
  then
    raise exception 'Cross-owner reservation visibility test failed.';
  end if;

  rejected := false;
  begin
    perform public.confirm_repair_image_upload(
      reserved_path,
      reserved_lease_id
    );
  exception
    when sqlstate '42501' then rejected := true;
  end;
  if not rejected then
    raise exception 'Cross-owner confirmation rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.abandon_repair_image_upload(
      reserved_path,
      reserved_lease_id
    );
  exception
    when sqlstate '42501' then rejected := true;
  end;
  if not rejected then
    raise exception 'Cross-owner abandonment rejection test failed.';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    owner_id::text,
    true
  );

  rejected := false;
  begin
    perform public.confirm_repair_image_upload(
      reserved_path,
      pg_catalog.gen_random_uuid()
    );
  exception
    when sqlstate '42501' then rejected := true;
  end;
  if not rejected then
    raise exception 'Mismatched lease confirmation rejection test failed.';
  end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('repair-images', reserved_path, owner_id::text);

  function_result := public.confirm_repair_image_upload(
    reserved_path,
    reserved_lease_id
  );
  if function_result is distinct from 'uploaded' then
    raise exception 'Upload confirmation state test failed.';
  end if;

  if public.can_upload_reserved_repair_image(reserved_path)
    is distinct from false
  then
    raise exception 'Confirmed object remained upload-authorized.';
  end if;

  function_result := public.confirm_repair_image_upload(
    reserved_path,
    reserved_lease_id
  );
  if function_result is distinct from 'uploaded' then
    raise exception 'Idempotent confirmation retry test failed.';
  end if;

  select
    reservation.object_path,
    reservation.upload_lease_id,
    reservation.upload_lease_expires_at
  into abandoned_path, abandoned_lease_id, abandoned_expires_at
  from public.reserve_repair_image_upload('png') reservation;

  if abandoned_path is not distinct from reserved_path then
    raise exception 'Independent reservations reused a registry path.';
  end if;

  rejected := false;
  begin
    perform public.abandon_repair_image_upload(
      abandoned_path,
      pg_catalog.gen_random_uuid()
    );
  exception
    when sqlstate '42501' then rejected := true;
  end;
  if not rejected then
    raise exception 'Mismatched lease abandonment rejection test failed.';
  end if;

  function_result := public.abandon_repair_image_upload(
    abandoned_path,
    abandoned_lease_id
  );
  if function_result is distinct from 'reserved' then
    raise exception 'Logical abandonment state test failed.';
  end if;

  select
    registry.lifecycle_state,
    registry.upload_lease_id,
    registry.upload_lease_expires_at
  into
    function_result,
    observed_lease_id,
    observed_lease_expires_at
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = 'repair-images'
    and registry.object_path = abandoned_path;

  if function_result is distinct from 'reserved'
    or observed_lease_id is distinct from abandoned_lease_id
    or observed_lease_expires_at is distinct from abandoned_expires_at
  then
    raise exception 'Logical abandonment changed the reservation or lease.';
  end if;

  function_result := public.abandon_repair_image_upload(
    abandoned_path,
    abandoned_lease_id
  );
  if function_result is distinct from 'reserved' then
    raise exception 'Idempotent logical abandonment retry test failed.';
  end if;

  rejected := false;
  begin
    insert into repair_image_private.repair_image_objects (
      bucket_id,
      object_path,
      owner_user_id,
      lifecycle_state,
      origin
    ) values (
      'repair-images',
      abandoned_path,
      owner_id,
      'discovered',
      'runtime'
    );
  exception
    when unique_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'Retained path reuse rejection test failed.';
  end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('repair-images', abandoned_path, owner_id::text);

  function_result := public.confirm_repair_image_upload(
    abandoned_path,
    abandoned_lease_id
  );
  if function_result is distinct from 'uploaded' then
    raise exception 'Confirmation after logical abandonment test failed.';
  end if;

  insert into repair_image_private.repair_image_objects (
    bucket_id,
    object_path,
    owner_user_id,
    lifecycle_state,
    origin,
    upload_lease_id,
    upload_lease_expires_at,
    created_at
  ) values (
    'repair-images',
    expired_path,
    owner_id,
    'reserved',
    'runtime',
    expired_lease_id,
    pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp() - interval '2 hours'
  );

  if public.can_upload_reserved_repair_image(expired_path)
    is distinct from false
  then
    raise exception 'Expired lease authorization test failed.';
  end if;

  function_result := public.abandon_repair_image_upload(
    expired_path,
    expired_lease_id
  );
  if function_result is distinct from 'reserved' then
    raise exception 'Expired reservation logical abandonment test failed.';
  end if;

  insert into storage.objects (bucket_id, name, owner_id)
  values ('repair-images', expired_path, owner_id::text);

  function_result := public.confirm_repair_image_upload(
    expired_path,
    expired_lease_id
  );
  if function_result is distinct from 'uploaded' then
    raise exception 'Expired lease recovery confirmation test failed.';
  end if;

  insert into repair_image_private.repair_image_objects (
    bucket_id,
    object_path,
    owner_user_id,
    lifecycle_state,
    origin,
    upload_lease_id,
    upload_lease_expires_at
  ) values (
    'repair-images',
    wrong_owner_path,
    owner_id,
    'reserved',
    'runtime',
    wrong_owner_lease_id,
    pg_catalog.clock_timestamp() + interval '15 minutes'
  );

  insert into storage.objects (bucket_id, name, owner_id)
  values ('repair-images', wrong_owner_path, other_owner_id::text);

  rejected := false;
  begin
    perform public.confirm_repair_image_upload(
      wrong_owner_path,
      wrong_owner_lease_id
    );
  exception
    when sqlstate '42501' then rejected := true;
  end;
  if not rejected then
    raise exception 'Storage ownership mismatch rejection test failed.';
  end if;

  function_result := public.abandon_repair_image_upload(
    wrong_owner_path,
    wrong_owner_lease_id
  );
  if function_result is distinct from 'reserved' then
    raise exception 'Logical abandonment depended on Storage metadata.';
  end if;
end;
$tests$;

rollback;
