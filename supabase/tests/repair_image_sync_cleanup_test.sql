begin;

do $identity_gate$
declare
  system_identifier text := (
    select control.system_identifier::text
    from pg_catalog.pg_control_system() as control
  );
begin
  if pg_catalog.current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
    or system_identifier is distinct from '7692131729119822239'
    or system_identifier = '7623125441096521075'
  then
    raise exception using
      errcode = '55000',
      message = 'Refusing repair image sync test: TEST identity mismatch.';
  end if;
end;
$identity_gate$;

-- Isolated PostgreSQL test only. Storage API is never called; every catalog and
-- data mutation below is rolled back.
do $tests$
declare
  owner_id constant uuid := '33333333-3333-4333-8333-333333333333';
  other_owner_id constant uuid := '55555555-5555-4555-8555-555555555555';
  request_one constant uuid := '44444444-4444-4444-8444-444444444441';
  request_two constant uuid := '44444444-4444-4444-8444-444444444442';
  rejected_request constant uuid := '44444444-4444-4444-8444-444444444443';
  path_one constant text :=
    '33333333-3333-4333-8333-333333333333/sync-one.jpg';
  path_two constant text :=
    '33333333-3333-4333-8333-333333333333/sync-two.jpg';
  missing_path constant text :=
    '33333333-3333-4333-8333-333333333333/missing.jpg';
  abandoned_path constant text :=
    '33333333-3333-4333-8333-333333333333/abandoned.jpg';
  expected_host text := repair_image_private.expected_storage_host();
  claim_id uuid;
  rejected boolean;
begin
  if expected_host is null then
    raise exception 'Test database identity is not approved.';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', owner_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

  insert into auth.users (id, aud, role)
  values
    (owner_id, 'authenticated', 'authenticated'),
    (other_owner_id, 'authenticated', 'authenticated');

  insert into repair_image_private.repair_image_objects (
    object_path,
    owner_user_id,
    lifecycle_state,
    origin,
    uploaded_at
  ) values
    (path_one, owner_id, 'discovered', 'reconciliation', pg_catalog.clock_timestamp()),
    (path_two, owner_id, 'discovered', 'reconciliation', pg_catalog.clock_timestamp());

  update repair_image_private.repair_image_objects
  set lifecycle_state = 'uploaded'
  where object_path in (path_one, path_two);

  insert into public.repair_requests (
    id, user_id, car_brand, car_model, car_year, city, damage_type, images
  ) values (
    request_one,
    owner_id,
    'Test',
    'Test',
    '2026',
    'Test',
    'test',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', 'one.jpg',
        'path', path_one,
        'url', 'https://' || expected_host ||
          '/storage/v1/object/public/repair-images/' || path_one,
        'fingerprint', pg_catalog.repeat('a', 64),
        'fingerprintVersion', 'sha256-prepared-v1'
      ),
      pg_catalog.jsonb_build_object(
        'name', 'two.jpg',
        'url', 'https://' || expected_host ||
          '/storage/v1/object/public/repair-images/' || path_two
      )
    )
  );

  if (
    select pg_catalog.count(*)
    from repair_image_private.repair_image_object_references
    where reference_id = request_one
  ) is distinct from 2::bigint then
    raise exception 'INSERT did not attach both modern and legacy references.';
  end if;

  -- A different authenticated owner cannot attach somebody else's confirmed
  -- path. The failed statement must not leave a request or registry reference.
  perform pg_catalog.set_config('request.jwt.claim.sub', other_owner_id::text, true);
  rejected := false;
  begin
    insert into public.repair_requests (
      id, user_id, car_brand, car_model, car_year, city, damage_type, images
    ) values (
      rejected_request,
      other_owner_id,
      'Test',
      'Test',
      '2026',
      'Test',
      'test',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('name', 'one.jpg', 'path', path_one)
      )
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected
    or exists (select 1 from public.repair_requests where id = rejected_request)
    or exists (
      select 1 from repair_image_private.repair_image_object_references
      where reference_id = rejected_request
    )
  then
    raise exception 'Cross-owner image reference was not rejected atomically.';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', owner_id::text, true);

  -- A save that introduces an unknown path fails as one statement and retains
  -- the request's previous reference set.
  rejected := false;
  begin
    update public.repair_requests
    set images = pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name', 'missing.jpg', 'path', missing_path)
    )
    where id = request_one;
  exception when check_violation then
    rejected := true;
  end;
  if not rejected or (
    select pg_catalog.count(*)
    from repair_image_private.repair_image_object_references
    where reference_id = request_one
  ) is distinct from 2::bigint then
    raise exception 'A failed request save changed the active reference set.';
  end if;

  -- A second request shares path_two. Removing it from request_one must retain
  -- the object because a valid reference still exists.
  insert into public.repair_requests (
    id, user_id, car_brand, car_model, car_year, city, damage_type, images
  ) values (
    request_two, owner_id, 'Test', 'Test', '2026', 'Test', 'test',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name', 'two.jpg', 'path', path_two)
    )
  );

  update public.repair_requests
  set images = pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('name', 'one.jpg', 'path', path_one)
  )
  where id = request_one;

  if (
    select lifecycle_state
    from repair_image_private.repair_image_objects
    where object_path = path_two
  ) is distinct from 'attached' then
    raise exception 'A shared image was retired while still referenced.';
  end if;

  -- Closing does not touch images or registry references.
  update public.repair_requests set status = 'closed' where id = request_one;
  if not exists (
    select 1 from repair_image_private.repair_image_object_references
    where reference_id = request_one and object_path = path_one
  ) then
    raise exception 'Closing a request detached its image.';
  end if;

  delete from public.repair_requests where id = request_one;
  if (
    select lifecycle_state
    from repair_image_private.repair_image_objects
    where object_path = path_one
  ) is distinct from 'tombstoned' then
    raise exception 'Deleting a request did not tombstone its unreferenced image.';
  end if;

  delete from public.repair_requests where id = request_two;
  if (
    select lifecycle_state
    from repair_image_private.repair_image_objects
    where object_path = path_two
  ) is distinct from 'tombstoned' then
    raise exception 'Removing the final shared reference did not tombstone the image.';
  end if;

  set constraints all immediate;

  -- Exercise worker retry bookkeeping without calling Storage API.
  insert into repair_image_private.repair_image_objects (
    object_path,
    owner_user_id,
    lifecycle_state,
    origin,
    upload_lease_id,
    upload_lease_expires_at,
    created_at
  ) values (
    abandoned_path,
    owner_id,
    'reserved',
    'runtime',
    '66666666-6666-4666-8666-666666666666',
    pg_catalog.clock_timestamp() - interval '2 hours',
    pg_catalog.clock_timestamp() - interval '3 hours'
  );

  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  select claim.delete_claim_id
  into claim_id
  from public.claim_repair_image_deletions(100) claim
  where claim.object_path = path_one;
  if claim_id is null then
    raise exception 'Worker did not claim a tombstoned image.';
  end if;

  if not exists (
    select 1
    from repair_image_private.repair_image_objects
    where object_path = abandoned_path
      and lifecycle_state = 'delete_claimed'
      and tombstone_reason = 'abandoned_upload'
  ) then
    raise exception 'Expired reserved upload was not safely classified for cleanup.';
  end if;

  perform public.complete_repair_image_deletion(path_one, claim_id, false);
  if (
    select lifecycle_state from repair_image_private.repair_image_objects
    where object_path = path_one
  ) is distinct from 'tombstoned' then
    raise exception 'Failed Storage deletion was not retained for retry.';
  end if;

  select claim.delete_claim_id
  into claim_id
  from public.claim_repair_image_deletions(100) claim
  where claim.object_path = path_one;
  perform public.complete_repair_image_deletion(path_one, claim_id, true);
  if (
    select lifecycle_state from repair_image_private.repair_image_objects
    where object_path = path_one
  ) is distinct from 'deleted' then
    raise exception 'Successful Storage deletion was not recorded.';
  end if;
end;
$tests$;

rollback;
