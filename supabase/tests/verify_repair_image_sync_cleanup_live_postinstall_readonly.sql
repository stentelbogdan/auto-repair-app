-- AutoRepair Marketplace
-- LIVE post-install verification for repair-image registry, trusted upload,
-- request synchronization, and cleanup.
--
-- READ ONLY. Contract: exactly 30 rows. Acceptance requires:
--   * checks 1..26 and 30 = PASS;
--   * checks 27..29 = INFO and manually reviewed;
--   * no ERROR before the result set.

BEGIN READ ONLY;

DO $identity_gate$
DECLARE
  v_system_identifier text;
BEGIN
  SELECT control.system_identifier::text
  INTO v_system_identifier
  FROM pg_catalog.pg_control_system() AS control;

  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres'
     OR CURRENT_USER IS DISTINCT FROM 'postgres'
     OR v_system_identifier IS DISTINCT FROM '7623125441096521075'
     OR v_system_identifier = '7692131729119822239' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'LIVE repair-image post-install identity mismatch.';
  END IF;

  IF pg_catalog.to_regclass(
       'repair_image_private.repair_image_objects'
     ) IS NULL
     OR pg_catalog.to_regclass(
       'repair_image_private.repair_image_object_references'
     ) IS NULL
     OR pg_catalog.to_regclass('public.repair_requests') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'LIVE repair-image post-install prerequisites are missing.';
  END IF;
END;
$identity_gate$;

WITH
constants AS (
  SELECT
    'ouoiykudvcoqbkybkqvs.supabase.co'::text AS expected_host,
    207::bigint AS historical_reference_count,
    133::bigint AS historical_legacy_count,
    74::bigint AS historical_modern_count
),
expected_private_columns AS MATERIALIZED (
  SELECT *
  FROM (VALUES
    ('repair_image_objects', 1, 'bucket_id', 'text', true, NULL, NULL, '''repair-images''::text', 'pg_catalog', 'default'),
    ('repair_image_objects', 2, 'object_path', 'text', true, NULL, NULL, NULL, 'pg_catalog', 'default'),
    ('repair_image_objects', 3, 'owner_user_id', 'uuid', true, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 4, 'lifecycle_state', 'text', true, NULL, NULL, '''discovered''::text', 'pg_catalog', 'default'),
    ('repair_image_objects', 5, 'origin', 'text', true, NULL, NULL, '''runtime''::text', 'pg_catalog', 'default'),
    ('repair_image_objects', 6, 'row_version', 'bigint', true, NULL, NULL, '1', NULL, NULL),
    ('repair_image_objects', 7, 'upload_lease_id', 'uuid', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 8, 'upload_lease_expires_at', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 9, 'uploaded_at', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 10, 'first_observed_at', 'timestamp with time zone', true, NULL, NULL, 'clock_timestamp()', NULL, NULL),
    ('repair_image_objects', 11, 'last_observed_at', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 12, 'last_reference_scan_at', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 13, 'consecutive_unreferenced_scans', 'integer', true, NULL, NULL, '0', NULL, NULL),
    ('repair_image_objects', 14, 'unreferenced_since', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 15, 'tombstoned_at', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 16, 'tombstone_reason', 'text', false, NULL, NULL, NULL, 'pg_catalog', 'default'),
    ('repair_image_objects', 17, 'delete_claim_id', 'uuid', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 18, 'delete_lease_expires_at', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 19, 'deleted_at', 'timestamp with time zone', false, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_objects', 20, 'created_at', 'timestamp with time zone', true, NULL, NULL, 'clock_timestamp()', NULL, NULL),
    ('repair_image_objects', 21, 'updated_at', 'timestamp with time zone', true, NULL, NULL, 'clock_timestamp()', NULL, NULL),
    ('repair_image_object_references', 1, 'bucket_id', 'text', true, NULL, NULL, NULL, 'pg_catalog', 'default'),
    ('repair_image_object_references', 2, 'object_path', 'text', true, NULL, NULL, NULL, 'pg_catalog', 'default'),
    ('repair_image_object_references', 3, 'reference_type', 'text', true, NULL, NULL, '''repair_request_image''::text', 'pg_catalog', 'default'),
    ('repair_image_object_references', 4, 'reference_id', 'uuid', true, NULL, NULL, NULL, NULL, NULL),
    ('repair_image_object_references', 5, 'first_seen_at', 'timestamp with time zone', true, NULL, NULL, 'clock_timestamp()', NULL, NULL),
    ('repair_image_object_references', 6, 'last_verified_at', 'timestamp with time zone', true, NULL, NULL, 'clock_timestamp()', NULL, NULL),
    ('repair_image_object_references', 7, 'created_at', 'timestamp with time zone', true, NULL, NULL, 'clock_timestamp()', NULL, NULL)
  ) AS expected(
    table_name, ordinal_position, column_name, data_type, not_null,
    identity_kind, generated_kind, column_default,
    collation_schema, collation_name
  )
),
actual_private_columns AS MATERIALIZED (
  SELECT
    table_record.relname::text AS table_name,
    column_record.attnum::integer AS ordinal_position,
    column_record.attname::text AS column_name,
    pg_catalog.format_type(
      column_record.atttypid, column_record.atttypmod
    )::text AS data_type,
    column_record.attnotnull AS not_null,
    NULLIF(column_record.attidentity::text, '') AS identity_kind,
    NULLIF(column_record.attgenerated::text, '') AS generated_kind,
    pg_catalog.pg_get_expr(
      default_record.adbin, default_record.adrelid
    )::text AS column_default,
    collation_schema.nspname::text AS collation_schema,
    collation_record.collname::text AS collation_name
  FROM pg_catalog.pg_attribute AS column_record
  JOIN pg_catalog.pg_class AS table_record
    ON table_record.oid = column_record.attrelid
  JOIN pg_catalog.pg_namespace AS table_schema
    ON table_schema.oid = table_record.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS default_record
    ON default_record.adrelid = column_record.attrelid
   AND default_record.adnum = column_record.attnum
  LEFT JOIN pg_catalog.pg_collation AS collation_record
    ON collation_record.oid = column_record.attcollation
   AND column_record.attcollation <> 0
  LEFT JOIN pg_catalog.pg_namespace AS collation_schema
    ON collation_schema.oid = collation_record.collnamespace
  WHERE table_schema.nspname = 'repair_image_private'
    AND table_record.relname IN (
      'repair_image_objects',
      'repair_image_object_references'
    )
    AND column_record.attnum > 0
    AND NOT column_record.attisdropped
),
expected_private_constraints AS MATERIALIZED (
  SELECT *
  FROM (VALUES
    ('repair_image_objects', 'repair_image_objects_pkey', 'p', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_bucket_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_path_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_path_owner_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_state_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_origin_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_version_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_scan_count_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_upload_lease_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_orphan_candidate_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_tombstone_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_delete_claim_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'repair_image_objects_deleted_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_objects', 'enforce_repair_image_object_consistency', 't', true, true, true, NULL, NULL),
    ('repair_image_object_references', 'repair_image_object_references_pkey', 'p', false, false, true, NULL, NULL),
    ('repair_image_object_references', 'repair_image_object_references_object_fkey', 'f', false, false, true, 'repair_image_private', 'repair_image_objects'),
    ('repair_image_object_references', 'repair_image_object_references_type_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_object_references', 'repair_image_object_references_bucket_check', 'c', false, false, true, NULL, NULL),
    ('repair_image_object_references', 'enforce_repair_image_reference_consistency', 't', true, true, true, NULL, NULL)
  ) AS expected(
    table_name, constraint_name, constraint_type, deferrable,
    initially_deferred, validated, referenced_schema, referenced_table
  )
),
actual_private_constraints AS MATERIALIZED (
  SELECT
    local_table.relname::text AS table_name,
    constraint_record.conname::text AS constraint_name,
    constraint_record.contype::text AS constraint_type,
    constraint_record.condeferrable AS deferrable,
    constraint_record.condeferred AS initially_deferred,
    constraint_record.convalidated AS validated,
    foreign_schema.nspname::text AS referenced_schema,
    foreign_table.relname::text AS referenced_table,
    pg_catalog.pg_get_constraintdef(
      constraint_record.oid, true
    )::text AS definition
  FROM pg_catalog.pg_constraint AS constraint_record
  JOIN pg_catalog.pg_class AS local_table
    ON local_table.oid = constraint_record.conrelid
  JOIN pg_catalog.pg_namespace AS local_schema
    ON local_schema.oid = local_table.relnamespace
  LEFT JOIN pg_catalog.pg_class AS foreign_table
    ON foreign_table.oid = constraint_record.confrelid
  LEFT JOIN pg_catalog.pg_namespace AS foreign_schema
    ON foreign_schema.oid = foreign_table.relnamespace
  WHERE local_schema.nspname = 'repair_image_private'
),
normalized_references AS MATERIALIZED (
  SELECT
    request.id AS request_id,
    request.user_id,
    reference.object_path,
    reference.reference_format
  FROM public.repair_requests AS request
  CROSS JOIN constants
  CROSS JOIN LATERAL public.extract_repair_image_storage_references(
    request.images,
    constants.expected_host
  ) AS reference
),
expected_reference_set AS MATERIALIZED (
  SELECT DISTINCT request_id, user_id, object_path
  FROM normalized_references
),
actual_reference_set AS MATERIALIZED (
  SELECT reference.reference_id AS request_id, reference.object_path
  FROM repair_image_private.repair_image_object_references AS reference
  WHERE reference.bucket_id = 'repair-images'
    AND reference.reference_type = 'repair_request_image'
),
cleanup_candidates AS MATERIALIZED (
  SELECT registry.object_path, registry.lifecycle_state
  FROM repair_image_private.repair_image_objects AS registry
  WHERE
    (
      registry.lifecycle_state = 'tombstoned'
      OR (
        registry.lifecycle_state = 'delete_claimed'
        AND registry.delete_lease_expires_at <= pg_catalog.clock_timestamp()
      )
      OR (
        registry.lifecycle_state = 'reserved'
        AND registry.upload_lease_expires_at
              <= pg_catalog.clock_timestamp() - interval '1 hour'
      )
      OR (
        registry.lifecycle_state = 'uploaded'
        AND registry.uploaded_at
              <= pg_catalog.clock_timestamp() - interval '1 hour'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM repair_image_private.repair_image_object_references AS reference
      WHERE reference.bucket_id = registry.bucket_id
        AND reference.object_path = registry.object_path
    )
),
checks(check_number, check_name, status, observed, expected) AS (
  SELECT
    1,
    'live_identity',
    'PASS',
    pg_catalog.format(
      '%s/%s/%s',
      pg_catalog.current_database(),
      CURRENT_USER,
      control.system_identifier::text
    ),
    'postgres/postgres/7623125441096521075'
  FROM pg_catalog.pg_control_system() AS control

  UNION ALL
  SELECT
    2,
    'private_schema_security',
    CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    'postgres-owned schema; no USAGE for PUBLIC/anon/authenticated/service_role'
  FROM pg_catalog.pg_namespace AS namespace_record
  WHERE namespace_record.nspname = 'repair_image_private'
    AND namespace_record.nspowner = pg_catalog.to_regrole('postgres')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(COALESCE(
        namespace_record.nspacl,
        pg_catalog.acldefault('n', namespace_record.nspowner)
      )) AS acl
      WHERE acl.grantee <> namespace_record.nspowner
    )

  UNION ALL
  SELECT
    3,
    'private_tables_security',
    CASE WHEN pg_catalog.count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '2 postgres-owned FORCE RLS tables without API-role table privileges'
  FROM pg_catalog.pg_class AS table_record
  JOIN pg_catalog.pg_namespace AS table_schema
    ON table_schema.oid = table_record.relnamespace
  WHERE table_schema.nspname = 'repair_image_private'
    AND table_record.relname IN (
      'repair_image_objects',
      'repair_image_object_references'
    )
    AND table_record.relkind = 'r'
    AND table_record.relowner = pg_catalog.to_regrole('postgres')
    AND table_record.relrowsecurity
    AND table_record.relforcerowsecurity
    AND NOT pg_catalog.has_table_privilege(
      'anon', table_record.oid, 'SELECT,INSERT,UPDATE,DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'authenticated', table_record.oid, 'SELECT,INSERT,UPDATE,DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role', table_record.oid, 'SELECT,INSERT,UPDATE,DELETE'
    )

  UNION ALL
  SELECT
    4,
    'private_relation_contract',
    CASE
      WHEN pg_catalog.count(*) = 8
       AND pg_catalog.count(*) FILTER (
         WHERE relation_record.relname IN (
           'repair_image_objects',
           'repair_image_objects_pkey',
           'repair_image_objects_owner_state_idx',
           'repair_image_objects_orphan_scan_idx',
           'repair_image_objects_delete_lease_idx',
           'repair_image_object_references',
           'repair_image_object_references_pkey',
           'repair_image_object_references_request_idx'
         )
       ) = 8
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    '8 exact registry tables/indexes'
  FROM pg_catalog.pg_class AS relation_record
  JOIN pg_catalog.pg_namespace AS relation_schema
    ON relation_schema.oid = relation_record.relnamespace
  WHERE relation_schema.nspname = 'repair_image_private'
    AND relation_record.relkind IN ('r', 'p', 'i')

  UNION ALL
  SELECT
    5,
    'private_column_contract',
    CASE
      WHEN pg_catalog.count(*) = 0
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    '0 missing, extra, reordered, or metadata-mismatched columns'
  FROM (
    (
      SELECT * FROM expected_private_columns
      EXCEPT
      SELECT * FROM actual_private_columns
    )
    UNION ALL
    (
      SELECT * FROM actual_private_columns
      EXCEPT
      SELECT * FROM expected_private_columns
    )
  ) AS column_differences

  UNION ALL
  SELECT
    6,
    'private_constraint_contract',
    CASE
      WHEN pg_catalog.count(*) = 0
       AND NOT EXISTS (
         SELECT 1
         FROM actual_private_constraints AS actual
         WHERE actual.definition IS NULL
            OR pg_catalog.btrim(actual.definition) = ''
       )
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    '0 missing, extra, or catalog-property-mismatched constraints; all definitions present'
  FROM (
    (
      SELECT
        table_name, constraint_name, constraint_type, deferrable,
        initially_deferred, validated, referenced_schema, referenced_table
      FROM expected_private_constraints
      EXCEPT
      SELECT
        table_name, constraint_name, constraint_type, deferrable,
        initially_deferred, validated, referenced_schema, referenced_table
      FROM actual_private_constraints
    )
    UNION ALL
    (
      SELECT
        table_name, constraint_name, constraint_type, deferrable,
        initially_deferred, validated, referenced_schema, referenced_table
      FROM actual_private_constraints
      EXCEPT
      SELECT
        table_name, constraint_name, constraint_type, deferrable,
        initially_deferred, validated, referenced_schema, referenced_table
      FROM expected_private_constraints
    )
  ) AS constraint_differences

  UNION ALL
  SELECT
    7,
    'private_trigger_contract',
    CASE
      WHEN pg_catalog.count(*) = 6
       AND pg_catalog.count(*) FILTER (
         WHERE trigger_record.tgenabled = 'O'
           AND (
             table_record.relname || '|' || trigger_record.tgname || '|' ||
             trigger_record.tgtype::text || '|' ||
             trigger_record.tgdeferrable::text || '|' ||
             trigger_record.tginitdeferred::text || '|' ||
             trigger_record.tgfoid::pg_catalog.regprocedure::text
           ) IN (
             'repair_image_objects|guard_repair_image_object_insert|7|false|false|repair_image_private.guard_repair_image_object_insert()',
             'repair_image_objects|prevent_repair_image_object_delete|11|false|false|repair_image_private.prevent_repair_image_object_delete()',
             'repair_image_objects|enforce_repair_image_object_transition|19|false|false|repair_image_private.enforce_repair_image_object_transition()',
             'repair_image_objects|enforce_repair_image_object_consistency|29|true|true|repair_image_private.enforce_repair_image_reference_consistency()',
             'repair_image_object_references|guard_repair_image_reference_mutation|31|false|false|repair_image_private.guard_repair_image_reference_mutation()',
             'repair_image_object_references|enforce_repair_image_reference_consistency|29|true|true|repair_image_private.enforce_repair_image_reference_consistency()'
           )
       ) = 6
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    '6 exact enabled registry triggers'
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_class AS table_record
    ON table_record.oid = trigger_record.tgrelid
  JOIN pg_catalog.pg_namespace AS table_schema
    ON table_schema.oid = table_record.relnamespace
  WHERE table_schema.nspname = 'repair_image_private'
    AND NOT trigger_record.tgisinternal

  UNION ALL
  SELECT
    8,
    'private_function_contract',
    CASE
      WHEN pg_catalog.count(*) = 7
       AND pg_catalog.count(*) FILTER (
         WHERE function_record.proowner = pg_catalog.to_regrole('postgres')
           AND pg_catalog.pg_get_function_identity_arguments(
             function_record.oid
           ) = ''
           AND function_record.proconfig = ARRAY['search_path=""']
           AND (
             function_record.proname || '|' ||
             pg_catalog.md5(function_record.prosrc)
           ) IN (
             'guard_repair_image_object_insert|1ab17078df64f154f5f1794bc7e46ec5',
             'prevent_repair_image_object_delete|cc0c64698aa699980de031a8e7f01526',
             'enforce_repair_image_object_transition|3aac34e83abca0d6205805fa86b13247',
             'guard_repair_image_reference_mutation|ac4bd85e7f6c45b9fdddba54475151e9',
             'enforce_repair_image_reference_consistency|0fe44eaaa9e4a40024c423e237a33046',
             'expected_storage_host|3861de78298fd1198cf18149727dc840',
             'sync_repair_request_images|e8051acfa2d27f95e0724759c631606d'
           )
           AND function_record.prosecdef = (
             function_record.proname IN (
               'enforce_repair_image_reference_consistency',
               'sync_repair_request_images'
             )
           )
       ) = 7
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    '7 exact postgres-owned private function contracts'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'repair_image_private'

  UNION ALL
  SELECT
    9,
    'private_function_acl',
    CASE
      WHEN pg_catalog.count(*) = 7
       AND pg_catalog.bool_and(NOT EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(function_record.proacl) AS acl
         WHERE acl.grantee <> function_record.proowner
       ))
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    '7 functions with no non-owner EXECUTE grants'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'repair_image_private'
    AND function_record.proacl IS NOT NULL

  UNION ALL
  SELECT
    10,
    'normalizer_function_contract',
    CASE WHEN pg_catalog.count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '2 exact immutable postgres-owned normalizer functions'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_record.proowner = pg_catalog.to_regrole('postgres')
    AND NOT function_record.prosecdef
    AND function_record.provolatile = 'i'
    AND function_record.proparallel = 's'
    AND function_record.proconfig = ARRAY['search_path=""']
    AND function_record.proacl IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(function_record.proacl) AS acl
      WHERE acl.grantee <> function_record.proowner
    )
    AND (
      function_record.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(function_record.oid) ||
      ')|' || pg_catalog.md5(function_record.prosrc)
    ) IN (
      'normalize_repair_image_storage_reference(p_reference text, p_reference_kind text, p_expected_host text)|5f1803d661641bf52329e26d9886b044',
      'extract_repair_image_storage_references(p_images jsonb, p_expected_host text)|c10e29eda6924c7686f2332d69054039'
    )

  UNION ALL
  SELECT
    11,
    'trusted_upload_function_contract',
    CASE WHEN pg_catalog.count(*) = 4 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '4 exact postgres-owned SECURITY DEFINER upload functions'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_record.proowner = pg_catalog.to_regrole('postgres')
    AND function_record.prosecdef
    AND function_record.proconfig = ARRAY['search_path=""']
    AND (
      function_record.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(function_record.oid) ||
      ')|' || pg_catalog.md5(function_record.prosrc)
    ) IN (
      'reserve_repair_image_upload(p_file_extension text)|84f68a9f1183bb7a99293ab11bf00894',
      'can_upload_reserved_repair_image(p_object_path text)|a072913a65500770ee3b694f5e363cfc',
      'confirm_repair_image_upload(p_object_path text, p_upload_lease_id uuid)|a159e081bbe84a01632efe03bb98425f',
      'abandon_repair_image_upload(p_object_path text, p_upload_lease_id uuid)|ce123361bf993c650155a3d80d73de2e'
    )

  UNION ALL
  SELECT
    12,
    'trusted_upload_function_acl',
    CASE
      WHEN pg_catalog.count(*) = 4
       AND pg_catalog.bool_and((
         SELECT pg_catalog.count(*) = 2
           AND pg_catalog.count(*) FILTER (
             WHERE acl.privilege_type = 'EXECUTE'
               AND NOT acl.is_grantable
               AND pg_catalog.pg_get_userbyid(acl.grantor) = 'postgres'
               AND pg_catalog.pg_get_userbyid(acl.grantee)
                     IN ('postgres', 'authenticated')
           ) = 2
         FROM pg_catalog.aclexplode(function_record.proacl) AS acl
       ))
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    'owner + authenticated EXECUTE only for all 4 functions'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_record.proname IN (
      'reserve_repair_image_upload',
      'can_upload_reserved_repair_image',
      'confirm_repair_image_upload',
      'abandon_repair_image_upload'
    )

  UNION ALL
  SELECT
    13,
    'cleanup_function_contract',
    CASE WHEN pg_catalog.count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '2 exact postgres-owned SECURITY DEFINER cleanup RPCs'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'public'
    AND function_record.proowner = pg_catalog.to_regrole('postgres')
    AND function_record.prosecdef
    AND function_record.provolatile = 'v'
    AND function_record.proparallel = 'u'
    AND function_record.proconfig = ARRAY['search_path=""']
    AND (
      function_record.proname || '(' ||
      pg_catalog.pg_get_function_identity_arguments(function_record.oid) ||
      ')|' || pg_catalog.md5(function_record.prosrc)
    ) IN (
      'claim_repair_image_deletions(p_limit integer)|ebb4cf9ddd5775812b573533e45dd8b8',
      'complete_repair_image_deletion(p_object_path text, p_delete_claim_id uuid, p_deleted boolean)|5b1cad0ca7e1bfe425d6341c64afd5fa'
    )

  UNION ALL
  SELECT
    14,
    'cleanup_function_acl',
    CASE
      WHEN pg_catalog.count(*) = 2
       AND pg_catalog.bool_and((
         SELECT pg_catalog.count(*) = 2
           AND pg_catalog.count(*) FILTER (
             WHERE acl.privilege_type = 'EXECUTE'
               AND NOT acl.is_grantable
               AND pg_catalog.pg_get_userbyid(acl.grantor) = 'postgres'
               AND pg_catalog.pg_get_userbyid(acl.grantee)
                     IN ('postgres', 'service_role')
           ) = 2
         FROM pg_catalog.aclexplode(function_record.proacl) AS acl
       ))
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    'owner + service_role EXECUTE only for both RPCs'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'public'
    AND (
      (
        function_record.proname = 'claim_repair_image_deletions'
        AND pg_catalog.oidvectortypes(function_record.proargtypes) = 'integer'
      )
      OR (
        function_record.proname = 'complete_repair_image_deletion'
        AND pg_catalog.oidvectortypes(function_record.proargtypes)
              = 'text, uuid, boolean'
      )
    )

  UNION ALL
  SELECT
    15,
    'request_sync_trigger_contract',
    CASE
      WHEN pg_catalog.count(*) = 3
       AND pg_catalog.count(*) FILTER (
         WHERE trigger_record.tgenabled = 'O'
           AND NOT trigger_record.tgisinternal
           AND trigger_record.tgfoid = pg_catalog.to_regprocedure(
             'repair_image_private.sync_repair_request_images()'
           )
           AND (
             (trigger_record.tgname = 'sync_repair_request_images_after_insert'
                AND trigger_record.tgtype = 5)
             OR
             (trigger_record.tgname = 'sync_repair_request_images_after_update'
                AND trigger_record.tgtype = 17
                AND position(
                  'UPDATE OF images' IN
                  pg_catalog.pg_get_triggerdef(trigger_record.oid, true)
                ) > 0)
             OR
             (trigger_record.tgname = 'sync_repair_request_images_after_delete'
                AND trigger_record.tgtype = 9)
           )
       ) = 3
      THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(*)::text,
    '3 exact enabled AFTER ROW synchronization triggers'
  FROM pg_catalog.pg_trigger AS trigger_record
  WHERE trigger_record.tgrelid = 'public.repair_requests'::pg_catalog.regclass
    AND trigger_record.tgname IN (
      'sync_repair_request_images_after_insert',
      'sync_repair_request_images_after_update',
      'sync_repair_request_images_after_delete'
    )

  UNION ALL
  SELECT
    16,
    'reserved_upload_storage_policy',
    CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    'one exact permissive authenticated INSERT policy for reserved repair-images'
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
    AND policy_record.polname =
        'Authenticated users can upload reserved repair images'
    AND policy_record.polcmd = 'a'
    AND policy_record.polpermissive
    AND policy_record.polroles = ARRAY[
      pg_catalog.to_regrole('authenticated')::oid
    ]
    AND policy_record.polqual IS NULL
    AND pg_catalog.lower(pg_catalog.regexp_replace(
      pg_catalog.pg_get_expr(
        policy_record.polwithcheck, policy_record.polrelid
      ),
      '\s+', '', 'g'
    )) IN (
      '((bucket_id=''repair-images''::text)andcan_upload_reserved_repair_image(name))',
      '((bucket_id=''repair-images''::text)andpublic.can_upload_reserved_repair_image(name))'
    )

  UNION ALL
  SELECT
    17,
    'unexpected_repair_image_insert_policies_absent',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 alternative INSERT/ALL policies that can apply to API-role repair-images uploads'
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
    AND policy_record.polcmd IN ('a', '*')
    AND policy_record.polname <>
        'Authenticated users can upload reserved repair images'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(policy_record.polroles) AS policy_role(role_oid)
      WHERE CASE
        WHEN policy_role.role_oid = 0::oid THEN true
        ELSE
          pg_catalog.pg_has_role(
            'authenticated', policy_role.role_oid, 'MEMBER'
          )
          OR pg_catalog.pg_has_role(
            'anon', policy_role.role_oid, 'MEMBER'
          )
      END
    )

  UNION ALL
  SELECT
    18,
    'unexpected_repair_image_delete_policies',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 DELETE/ALL policies that can apply to API-role repair-images deletes'
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
    AND policy_record.polcmd IN ('d', '*')
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(policy_record.polroles) AS policy_role(role_oid)
      WHERE CASE
        WHEN policy_role.role_oid = 0::oid THEN true
        ELSE
          pg_catalog.pg_has_role(
            'authenticated', policy_role.role_oid, 'MEMBER'
          )
          OR pg_catalog.pg_has_role(
            'anon', policy_role.role_oid, 'MEMBER'
          )
      END
    )
    AND (
      policy_record.polqual IS NULL
      OR position(
        'bucket_id' IN pg_catalog.lower(pg_catalog.pg_get_expr(
          policy_record.polqual, policy_record.polrelid
        ))
      ) = 0
      OR position(
        'repair-images' IN pg_catalog.lower(pg_catalog.pg_get_expr(
          policy_record.polqual, policy_record.polrelid
        ))
      ) > 0
    )

  UNION ALL
  SELECT
    19,
    'historical_reference_count',
    CASE
      WHEN pg_catalog.count(reference.object_path)
             = constants.historical_reference_count
        THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(reference.object_path)::text,
    constants.historical_reference_count::text
  FROM constants
  LEFT JOIN normalized_references AS reference ON true
  GROUP BY constants.historical_reference_count

  UNION ALL
  SELECT
    20,
    'historical_legacy_reference_count',
    CASE
      WHEN pg_catalog.count(reference.object_path)
             = constants.historical_legacy_count
        THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(reference.object_path)::text,
    constants.historical_legacy_count::text
  FROM constants
  LEFT JOIN normalized_references AS reference
    ON reference.reference_format = 'legacy_url_only'
  GROUP BY constants.historical_legacy_count

  UNION ALL
  SELECT
    21,
    'historical_modern_reference_count',
    CASE
      WHEN pg_catalog.count(reference.object_path)
             = constants.historical_modern_count
        THEN 'PASS' ELSE 'FAIL'
    END,
    pg_catalog.count(reference.object_path)::text,
    constants.historical_modern_count::text
  FROM constants
  LEFT JOIN normalized_references AS reference
    ON reference.reference_format IN ('current_path_and_url', 'path_only')
  GROUP BY constants.historical_modern_count

  UNION ALL
  SELECT
    22,
    'backfill_reference_set_complete',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 missing or extra normalized active references'
  FROM (
    (
      SELECT request_id, object_path FROM expected_reference_set
      EXCEPT
      SELECT request_id, object_path FROM actual_reference_set
    )
    UNION ALL
    (
      SELECT request_id, object_path FROM actual_reference_set
      EXCEPT
      SELECT request_id, object_path FROM expected_reference_set
    )
  ) AS differences

  UNION ALL
  SELECT
    23,
    'backfill_registry_objects_complete',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 missing/wrong-owner/non-attached referenced registry objects'
  FROM expected_reference_set AS expected
  LEFT JOIN repair_image_private.repair_image_objects AS registry
    ON registry.bucket_id = 'repair-images'
   AND registry.object_path = expected.object_path
  WHERE registry.object_path IS NULL
     OR registry.owner_user_id IS DISTINCT FROM expected.user_id
     OR registry.lifecycle_state IS DISTINCT FROM 'attached'

  UNION ALL
  SELECT
    24,
    'referenced_storage_objects_present',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 missing Storage metadata rows'
  FROM expected_reference_set AS expected
  LEFT JOIN storage.objects AS storage_object
    ON storage_object.bucket_id = 'repair-images'
   AND storage_object.name = expected.object_path
  WHERE storage_object.id IS NULL

  UNION ALL
  SELECT
    25,
    'referenced_storage_ownership',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 Storage owner mismatches'
  FROM expected_reference_set AS expected
  JOIN storage.objects AS storage_object
    ON storage_object.bucket_id = 'repair-images'
   AND storage_object.name = expected.object_path
  WHERE storage_object.owner_id IS DISTINCT FROM expected.user_id::text

  UNION ALL
  SELECT
    26,
    'cleanup_eligible_objects',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 before first controlled worker invocation'
  FROM cleanup_candidates

  UNION ALL
  SELECT
    27,
    'registry_state_distribution',
    'INFO',
    COALESCE(pg_catalog.string_agg(
      state_counts.lifecycle_state || '=' || state_counts.row_count::text,
      ', ' ORDER BY state_counts.lifecycle_state COLLATE "C"
    ), 'EMPTY'),
    'manual review; historical references should be attached'
  FROM (
    SELECT registry.lifecycle_state, pg_catalog.count(*) AS row_count
    FROM repair_image_private.repair_image_objects AS registry
    GROUP BY registry.lifecycle_state
  ) AS state_counts

  UNION ALL
  SELECT
    28,
    'registry_object_count',
    'INFO',
    pg_catalog.count(*)::text,
    'review against distinct normalized Storage paths'
  FROM repair_image_private.repair_image_objects

  UNION ALL
  SELECT
    29,
    'registry_reference_count',
    'INFO',
    pg_catalog.count(*)::text,
    'review against distinct request/path pairs; raw historical count is 207'
  FROM repair_image_private.repair_image_object_references

  UNION ALL
  SELECT
    30,
    'quarantined_object_invariants',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '0 quarantined rows with leases, claims, deleted timestamps, or missing Storage metadata'
  FROM repair_image_private.repair_image_objects AS registry
  WHERE registry.lifecycle_state = 'quarantined'
    AND (
      registry.upload_lease_id IS NOT NULL
      OR registry.upload_lease_expires_at IS NOT NULL
      OR registry.delete_claim_id IS NOT NULL
      OR registry.delete_lease_expires_at IS NOT NULL
      OR registry.deleted_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM storage.objects AS storage_object
        WHERE storage_object.bucket_id = registry.bucket_id
          AND storage_object.name = registry.object_path
      )
    )
)
SELECT check_number, check_name, status, observed, expected
FROM checks
ORDER BY check_number;

ROLLBACK;
