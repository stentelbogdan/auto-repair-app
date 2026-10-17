-- TEST ONLY: fail-closed removal of the exact temporary barrier.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $gate$
DECLARE v_system_identifier text;
BEGIN
  SELECT control.system_identifier::text INTO v_system_identifier
  FROM pg_catalog.pg_control_system() AS control;
  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres'
     OR CURRENT_USER IS DISTINCT FROM 'postgres'
     OR v_system_identifier IS DISTINCT FROM '7692131729119822239'
     OR v_system_identifier = '7623125441096521075' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'TEST barrier removal identity mismatch.';
  END IF;
  IF pg_catalog.to_regprocedure('repair_image_private.sync_repair_request_images()') IS NULL
     OR pg_catalog.to_regprocedure('public.claim_repair_image_deletions(integer)') IS NULL
     OR pg_catalog.to_regprocedure('public.complete_repair_image_deletion(text,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'TEST post-130000 baseline is incomplete.';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_trigger AS t
    JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE t.tgrelid = 'storage.objects'::pg_catalog.regclass
      AND t.tgname = 'block_repair_image_storage_writes_during_maintenance'
      AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 31
      AND n.nspname = 'repair_image_private'
      AND p.proname = 'block_repair_image_storage_writes_during_maintenance'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
      AND p.prorettype = 'trigger'::pg_catalog.regtype
      AND pg_catalog.md5(p.prosrc) = 'b0559e204ecc97fcc5438bad0a833396'
  ) IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Exact TEST barrier is not present.';
  END IF;
END;
$gate$;
DROP TRIGGER block_repair_image_storage_writes_during_maintenance ON storage.objects;
DROP FUNCTION repair_image_private.block_repair_image_storage_writes_during_maintenance();
DO $postcheck$
BEGIN
  IF pg_catalog.to_regprocedure(
       'repair_image_private.block_repair_image_storage_writes_during_maintenance()'
     ) IS NOT NULL OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS t
       WHERE t.tgrelid = 'storage.objects'::pg_catalog.regclass
         AND t.tgname = 'block_repair_image_storage_writes_during_maintenance'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'TEST barrier removal failed.';
  END IF;
END;
$postcheck$;
COMMIT;
