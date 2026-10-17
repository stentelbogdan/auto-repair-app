begin;

-- Run only after applying 20261003110000 in an isolated PostgreSQL/Supabase database.
-- The transaction is always rolled back, including all synthetic registry rows.
do $tests$
declare
  test_owner constant uuid := '11111111-1111-4111-8111-111111111111';
  other_owner constant uuid := '22222222-2222-4222-8222-222222222222';
  test_path constant text :=
    '11111111-1111-4111-8111-111111111111/registry-test.jpg';
  discovered_path constant text :=
    '11111111-1111-4111-8111-111111111111/discovered-test.jpg';
  uploaded_reference_path constant text :=
    '11111111-1111-4111-8111-111111111111/uploaded-reference-test.jpg';
  orphan_reference_path constant text :=
    '11111111-1111-4111-8111-111111111111/orphan-reference-test.jpg';
  attached_consistency_path constant text :=
    '11111111-1111-4111-8111-111111111111/attached-consistency-test.jpg';
  rejected boolean;
  current_version bigint;
begin
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
      '11111111-1111-4111-8111-111111111111/invalid-initial-state.jpg',
      test_owner,
      'attached',
      'runtime'
    );
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Initial lifecycle state guard test failed.';
  end if;

  insert into repair_image_private.repair_image_objects (
    bucket_id,
    object_path,
    owner_user_id,
    lifecycle_state,
    origin
  ) values (
    'repair-images',
    discovered_path,
    test_owner,
    'discovered',
    'legacy_import'
  );

  set constraints all immediate;
  set constraints all deferred;

  rejected := false;
  begin
    delete from repair_image_private.repair_image_objects
    where bucket_id = 'repair-images'
      and object_path = discovered_path;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Discovered registry row physical deletion rejection test failed.';
  end if;

  if not exists (
    select 1
    from repair_image_private.repair_image_objects registry
    where registry.bucket_id = 'repair-images'
      and registry.object_path = discovered_path
  ) then
    raise exception 'Discovered registry row was removed by a rejected physical deletion.';
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
      '11111111-1111-4111-8111-111111111111/missing-lease.jpg',
      test_owner,
      'reserved',
      'runtime'
    );
  exception
    when check_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'Reserved upload lease requirement test failed.';
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
      '11111111-1111-4111-8111-111111111111/premature-orphan.jpg',
      test_owner,
      'discovered',
      'reconciliation'
    );

    update repair_image_private.repair_image_objects
    set
      lifecycle_state = 'orphan_candidate',
      last_reference_scan_at = pg_catalog.clock_timestamp(),
      consecutive_unreferenced_scans = 2,
      unreferenced_since = pg_catalog.clock_timestamp() - interval '1 hour'
    where bucket_id = 'repair-images'
      and object_path = '11111111-1111-4111-8111-111111111111/premature-orphan.jpg';
  exception
    when check_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'Orphan safety interval requirement test failed.';
  end if;

  insert into repair_image_private.repair_image_objects (
    bucket_id,
    object_path,
    owner_user_id,
    lifecycle_state,
    origin
  ) values (
    'repair-images',
    uploaded_reference_path,
    test_owner,
    'discovered',
    'legacy_import'
  );

  update repair_image_private.repair_image_objects
  set
    lifecycle_state = 'uploaded',
    uploaded_at = pg_catalog.clock_timestamp()
  where bucket_id = 'repair-images'
    and object_path = uploaded_reference_path;

  rejected := false;
  begin
    insert into repair_image_private.repair_image_object_references (
      bucket_id,
      object_path,
      reference_id
    ) values (
      'repair-images',
      uploaded_reference_path,
      '55555555-5555-4555-8555-555555555555'
    );

    -- Forces deferred constraint triggers inside this PL/pgSQL subtransaction.
    -- The expected failure rolls back the insert; deferred mode is restored
    -- explicitly after the exception block.
    set constraints all immediate;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  set constraints all deferred;
  if not rejected then
    raise exception 'Referenced non-attached object deferred consistency test failed.';
  end if;

  insert into repair_image_private.repair_image_objects (
    bucket_id,
    object_path,
    owner_user_id,
    lifecycle_state,
    origin
  ) values (
    'repair-images',
    orphan_reference_path,
    test_owner,
    'discovered',
    'reconciliation'
  );

  update repair_image_private.repair_image_objects
  set
    lifecycle_state = 'orphan_candidate',
    unreferenced_since = pg_catalog.clock_timestamp() - interval '25 hours',
    last_reference_scan_at = pg_catalog.clock_timestamp(),
    consecutive_unreferenced_scans = 2
  where bucket_id = 'repair-images'
    and object_path = orphan_reference_path;

  rejected := false;
  begin
    insert into repair_image_private.repair_image_object_references (
      bucket_id,
      object_path,
      reference_id
    ) values (
      'repair-images',
      orphan_reference_path,
      '66666666-6666-4666-8666-666666666666'
    );

    set constraints all immediate;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  set constraints all deferred;
  if not rejected then
    raise exception 'Orphan candidate active reference deferred consistency test failed.';
  end if;

  insert into repair_image_private.repair_image_objects (
    bucket_id,
    object_path,
    owner_user_id,
    lifecycle_state,
    origin
  ) values (
    'repair-images',
    attached_consistency_path,
    test_owner,
    'discovered',
    'legacy_import'
  );

  insert into repair_image_private.repair_image_object_references (
    bucket_id,
    object_path,
    reference_id
  ) values (
    'repair-images',
    attached_consistency_path,
    '77777777-7777-4777-8777-777777777777'
  );

  update repair_image_private.repair_image_objects
  set lifecycle_state = 'attached'
  where bucket_id = 'repair-images'
    and object_path = attached_consistency_path;

  set constraints all immediate;
  set constraints all deferred;

  rejected := false;
  begin
    delete from repair_image_private.repair_image_object_references
    where bucket_id = 'repair-images'
      and object_path = attached_consistency_path;

    set constraints all immediate;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  set constraints all deferred;
  if not rejected then
    raise exception 'Attached object without reference deferred consistency test failed.';
  end if;

  rejected := false;
  begin
    update repair_image_private.repair_image_objects
    set lifecycle_state = 'quarantined'
    where bucket_id = 'repair-images'
      and object_path = attached_consistency_path;

    set constraints all immediate;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  set constraints all deferred;
  if not rejected then
    raise exception 'Object-side deferred reference consistency test failed.';
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
    test_path,
    test_owner,
    'reserved',
    'runtime',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    pg_catalog.clock_timestamp() + interval '15 minutes'
  );

  update repair_image_private.repair_image_objects
  set
    lifecycle_state = 'uploaded',
    upload_lease_id = null,
    upload_lease_expires_at = null,
    uploaded_at = pg_catalog.clock_timestamp()
  where bucket_id = 'repair-images' and object_path = test_path;

  rejected := false;
  begin
    update repair_image_private.repair_image_objects
    set lifecycle_state = 'attached'
    where bucket_id = 'repair-images' and object_path = test_path;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Attached-without-reference rejection test failed.';
  end if;

  insert into repair_image_private.repair_image_object_references (
    bucket_id,
    object_path,
    reference_id
  ) values (
    'repair-images',
    test_path,
    '33333333-3333-4333-8333-333333333333'
  );

  update repair_image_private.repair_image_objects
  set lifecycle_state = 'attached'
  where bucket_id = 'repair-images' and object_path = test_path;

  set constraints all immediate;
  set constraints all deferred;

  select registry.row_version
  into current_version
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = 'repair-images'
    and registry.object_path = test_path;

  if current_version is distinct from 3 then
    raise exception 'Registry row version transition test failed.';
  end if;

  rejected := false;
  begin
    update repair_image_private.repair_image_objects
    set
      lifecycle_state = 'tombstoned',
      tombstoned_at = pg_catalog.clock_timestamp(),
      tombstone_reason = 'migration_test'
    where bucket_id = 'repair-images' and object_path = test_path;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Referenced object tombstone rejection test failed.';
  end if;

  delete from repair_image_private.repair_image_object_references
  where bucket_id = 'repair-images' and object_path = test_path;

  update repair_image_private.repair_image_objects
  set
    lifecycle_state = 'tombstoned',
    tombstoned_at = pg_catalog.clock_timestamp(),
    tombstone_reason = 'migration_test'
  where bucket_id = 'repair-images' and object_path = test_path;

  set constraints all immediate;
  set constraints all deferred;

  rejected := false;
  begin
    insert into repair_image_private.repair_image_object_references (
      bucket_id,
      object_path,
      reference_id
    ) values (
      'repair-images',
      test_path,
      '88888888-8888-4888-8888-888888888888'
    );
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Tombstoned object reference rejection test failed.';
  end if;

  rejected := false;
  begin
    update repair_image_private.repair_image_objects
    set lifecycle_state = 'attached'
    where bucket_id = 'repair-images' and object_path = test_path;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Tombstone reactivation rejection test failed.';
  end if;

  update repair_image_private.repair_image_objects
  set
    lifecycle_state = 'delete_claimed',
    delete_claim_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    delete_lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes'
  where bucket_id = 'repair-images' and object_path = test_path;

  rejected := false;
  begin
    insert into repair_image_private.repair_image_object_references (
      bucket_id,
      object_path,
      reference_id
    ) values (
      'repair-images',
      test_path,
      '99999999-9999-4999-8999-999999999999'
    );
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Delete-claimed object reference rejection test failed.';
  end if;

  update repair_image_private.repair_image_objects
  set
    lifecycle_state = 'deleted',
    delete_claim_id = null,
    delete_lease_expires_at = null,
    deleted_at = pg_catalog.clock_timestamp()
  where bucket_id = 'repair-images' and object_path = test_path;

  rejected := false;
  begin
    update repair_image_private.repair_image_objects
    set last_observed_at = pg_catalog.clock_timestamp()
    where bucket_id = 'repair-images' and object_path = test_path;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Deleted registry row immutability test failed.';
  end if;

  rejected := false;
  begin
    delete from repair_image_private.repair_image_objects
    where bucket_id = 'repair-images' and object_path = test_path;
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Deleted registry row physical deletion rejection test failed.';
  end if;

  if not exists (
    select 1
    from repair_image_private.repair_image_objects registry
    where registry.bucket_id = 'repair-images'
      and registry.object_path = test_path
      and registry.lifecycle_state = 'deleted'
  ) then
    raise exception 'Deleted registry row was removed by a rejected physical deletion.';
  end if;

  rejected := false;
  begin
    insert into repair_image_private.repair_image_object_references (
      bucket_id,
      object_path,
      reference_id
    ) values (
      'repair-images',
      test_path,
      '44444444-4444-4444-8444-444444444444'
    );
  exception
    when sqlstate '23514' then rejected := true;
  end;
  if not rejected then
    raise exception 'Deleted object reference rejection test failed.';
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
      test_path,
      test_owner,
      'discovered',
      'legacy_import'
    );
  exception
    when unique_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'Duplicate path reservation rejection test failed.';
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
      '11111111-1111-4111-8111-111111111111/owner-mismatch.jpg',
      other_owner,
      'discovered',
      'legacy_import'
    );
  exception
    when check_violation then rejected := true;
  end;
  if not rejected then
    raise exception 'Path owner mismatch rejection test failed.';
  end if;

  if pg_catalog.has_schema_privilege('anon', 'repair_image_private', 'USAGE')
    or pg_catalog.has_schema_privilege('authenticated', 'repair_image_private', 'USAGE')
    or pg_catalog.has_schema_privilege('service_role', 'repair_image_private', 'USAGE')
    or pg_catalog.has_table_privilege(
      'anon',
      'repair_image_private.repair_image_objects',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'repair_image_private.repair_image_objects',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'service_role',
      'repair_image_private.repair_image_objects',
      'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'authenticated',
      'repair_image_private.repair_image_object_references',
      'INSERT'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'repair_image_private.enforce_repair_image_object_transition()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'repair_image_private.enforce_repair_image_object_transition()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'repair_image_private.guard_repair_image_reference_mutation()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'repair_image_private.guard_repair_image_object_insert()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'repair_image_private.guard_repair_image_object_insert()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'repair_image_private.guard_repair_image_object_insert()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'repair_image_private.prevent_repair_image_object_delete()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'repair_image_private.prevent_repair_image_object_delete()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'repair_image_private.prevent_repair_image_object_delete()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'repair_image_private.enforce_repair_image_reference_consistency()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'repair_image_private.enforce_repair_image_reference_consistency()',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'repair_image_private.enforce_repair_image_reference_consistency()',
      'EXECUTE'
    )
  then
    raise exception 'Private registry privilege isolation test failed.';
  end if;

end;
$tests$;

rollback;
