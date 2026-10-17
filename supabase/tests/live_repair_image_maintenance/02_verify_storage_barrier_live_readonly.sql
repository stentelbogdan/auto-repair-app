-- AutoRepair Marketplace: verify the temporary LIVE Storage barrier.
-- Strictly READ ONLY. Expected result: 8 PASS rows.

BEGIN READ ONLY;

DO $identity_gate$
DECLARE
  v_system_identifier text;
BEGIN
  SELECT control.system_identifier::text INTO v_system_identifier
  FROM pg_catalog.pg_control_system() AS control;
  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres'
     OR CURRENT_USER IS DISTINCT FROM 'postgres'
     OR v_system_identifier IS DISTINCT FROM '7623125441096521075'
     OR v_system_identifier = '7692131729119822239' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'LIVE maintenance verifier identity mismatch.';
  END IF;
END;
$identity_gate$;

WITH checks(check_no, check_name, status, observed, expected) AS (
  SELECT 1, 'live_identity', 'PASS',
    'database=postgres,user=postgres,system_identifier=7623125441096521075',
    'exact LIVE identity'
  UNION ALL
  SELECT 2, 'repair_images_bucket',
    CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text, '1'
  FROM storage.buckets WHERE id = 'repair-images'
  UNION ALL
  SELECT 3, 'barrier_trigger_contract',
    CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    '1 enabled BEFORE ROW INSERT/UPDATE/DELETE trigger'
  FROM pg_catalog.pg_trigger AS trigger_record
  JOIN pg_catalog.pg_proc AS function_record
    ON function_record.oid = trigger_record.tgfoid
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE trigger_record.tgrelid = 'storage.objects'::pg_catalog.regclass
    AND trigger_record.tgname =
        'block_repair_image_storage_writes_during_maintenance'
    AND NOT trigger_record.tgisinternal
    AND trigger_record.tgenabled = 'O'
    AND trigger_record.tgtype = 31
    AND function_schema.nspname = 'repair_image_private'
    AND function_record.proname =
        'block_repair_image_storage_writes_during_maintenance'
  UNION ALL
  SELECT 4, 'barrier_function_contract',
    CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text,
    'postgres owner, invoker, plpgsql, trigger, empty search_path'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  JOIN pg_catalog.pg_language AS function_language
    ON function_language.oid = function_record.prolang
  WHERE function_schema.nspname = 'repair_image_private'
    AND function_record.proname =
        'block_repair_image_storage_writes_during_maintenance'
    AND pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''
    AND pg_catalog.pg_get_userbyid(function_record.proowner) = 'postgres'
    AND function_language.lanname = 'plpgsql'
    AND NOT function_record.prosecdef
    AND function_record.proconfig = ARRAY['search_path=""']
    AND function_record.prorettype = 'trigger'::pg_catalog.regtype
    AND function_record.provolatile = 'v'
    AND function_record.prokind = 'f'
    AND pg_catalog.md5(function_record.prosrc) =
        'b0559e204ecc97fcc5438bad0a833396'
  UNION ALL
  SELECT 5, 'barrier_function_acl',
    CASE WHEN function_record.proacl IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(function_record.proacl) AS acl
      WHERE acl.grantee <> function_record.proowner
    ) THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(function_record.proacl::text, 'NULL'),
    'explicit ACL with no non-owner EXECUTE grants'
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_record.pronamespace
  WHERE function_schema.nspname = 'repair_image_private'
    AND function_record.proname =
        'block_repair_image_storage_writes_during_maintenance'
    AND pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''
  UNION ALL
  SELECT 6, 'migration_130000_absent',
    CASE WHEN pg_catalog.to_regprocedure(
                    'repair_image_private.sync_repair_request_images()'
                  ) IS NULL
               AND pg_catalog.to_regprocedure(
                    'public.claim_repair_image_deletions(integer)'
                  ) IS NULL
         THEN 'PASS' ELSE 'FAIL' END,
    (pg_catalog.to_regprocedure(
       'repair_image_private.sync_repair_request_images()'
     ) IS NOT NULL)::text || ',' ||
    (pg_catalog.to_regprocedure(
       'public.claim_repair_image_deletions(integer)'
     ) IS NOT NULL)::text,
    'false,false'
  UNION ALL
  SELECT 7, 'reserved_upload_policy_absent',
    CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text, '0'
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
    AND policy_record.polname =
        'Authenticated users can upload reserved repair images'
  UNION ALL
  SELECT 8, 'legacy_policy_count',
    CASE WHEN pg_catalog.count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text, '2'
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
    AND policy_record.polname IN (
      'Authenticated users can upload own repair images',
      'Authenticated users can delete own repair images'
    )
)
SELECT check_no, check_name, status, observed, expected
FROM checks
ORDER BY check_no;

ROLLBACK;
