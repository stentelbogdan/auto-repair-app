-- TEST ONLY, READ ONLY. Expected result: 7 PASS rows.
BEGIN READ ONLY;
DO $identity$
DECLARE v_system_identifier text;
BEGIN
  SELECT control.system_identifier::text INTO v_system_identifier
  FROM pg_catalog.pg_control_system() AS control;
  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres'
     OR CURRENT_USER IS DISTINCT FROM 'postgres'
     OR v_system_identifier IS DISTINCT FROM '7692131729119822239'
     OR v_system_identifier = '7623125441096521075' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'TEST barrier verifier identity mismatch.';
  END IF;
END;
$identity$;

WITH checks(check_no, check_name, status, observed, expected) AS (
  SELECT 1, 'test_identity', 'PASS', '7692131729119822239', '7692131729119822239'
  UNION ALL
  SELECT 2, 'barrier_trigger_contract', CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text, '1 exact enabled BEFORE ROW INSERT/UPDATE/DELETE trigger'
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE t.tgrelid = 'storage.objects'::pg_catalog.regclass
    AND t.tgname = 'block_repair_image_storage_writes_during_maintenance'
    AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 31
    AND n.nspname = 'repair_image_private'
    AND p.proname = 'block_repair_image_storage_writes_during_maintenance'
  UNION ALL
  SELECT 3, 'barrier_function_contract', CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text, '1 exact function contract and prosrc hash'
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'repair_image_private'
    AND p.proname = 'block_repair_image_storage_writes_during_maintenance'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND p.prorettype = 'trigger'::pg_catalog.regtype
    AND pg_catalog.md5(p.prosrc) = 'b0559e204ecc97fcc5438bad0a833396'
  UNION ALL
  SELECT 4, 'barrier_function_acl', CASE WHEN pg_catalog.count(*) = 1
    AND pg_catalog.count(*) FILTER (WHERE p.proacl IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(p.proacl) AS acl WHERE acl.grantee <> p.proowner
    )) = 1 THEN 'PASS' ELSE 'FAIL' END,
    COALESCE(pg_catalog.string_agg(p.proacl::text, ','), 'MISSING'),
    'one function with explicit owner-only ACL'
  FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'repair_image_private'
    AND p.proname = 'block_repair_image_storage_writes_during_maintenance'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  UNION ALL
  SELECT 5, 'post_130000_functions', CASE WHEN
    pg_catalog.to_regprocedure('repair_image_private.sync_repair_request_images()') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.claim_repair_image_deletions(integer)') IS NOT NULL
    AND pg_catalog.to_regprocedure('public.complete_repair_image_deletion(text,uuid,boolean)') IS NOT NULL
    THEN 'PASS' ELSE 'FAIL' END, 'catalog checked', 'all 3 present'
  UNION ALL
  SELECT 6, 'reserved_upload_policy', CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text, '1'
  FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid = 'storage.objects'::pg_catalog.regclass
    AND p.polname = 'Authenticated users can upload reserved repair images'
    AND p.polcmd = 'a' AND p.polpermissive
  UNION ALL
  SELECT 7, 'quarantined_baseline', CASE WHEN pg_catalog.count(*) = 6 THEN 'PASS' ELSE 'FAIL' END,
    pg_catalog.count(*)::text, '6'
  FROM repair_image_private.repair_image_objects
  WHERE lifecycle_state = 'quarantined'
)
SELECT check_no, check_name, status, observed, expected FROM checks ORDER BY check_no;
ROLLBACK;
