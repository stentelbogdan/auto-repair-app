-- AutoRepair Marketplace
-- LIVE ONLY: remove the temporary barrier after successful migration 130000.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $postinstall_gate$
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
      MESSAGE = 'LIVE post-install barrier removal identity mismatch.';
  END IF;

  IF pg_catalog.to_regprocedure(
       'repair_image_private.sync_repair_request_images()'
     ) IS NULL OR pg_catalog.to_regprocedure(
       'public.claim_repair_image_deletions(integer)'
     ) IS NULL OR pg_catalog.to_regprocedure(
       'public.complete_repair_image_deletion(text,uuid,boolean)'
     ) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Migration 130000 function markers are incomplete.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = 'public.repair_requests'::pg_catalog.regclass
      AND trigger_record.tgname IN (
        'sync_repair_request_images_after_insert',
        'sync_repair_request_images_after_update',
        'sync_repair_request_images_after_delete'
      )
      AND NOT trigger_record.tgisinternal
      AND trigger_record.tgenabled = 'O'
  ) IS DISTINCT FROM 3::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Migration 130000 trigger markers are incomplete.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
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
        ), '\s+', '', 'g'
      )) IN (
        '((bucket_id=''repair-images''::text)andcan_upload_reserved_repair_image(name))',
        '((bucket_id=''repair-images''::text)andpublic.can_upload_reserved_repair_image(name))'
      )
  ) IS DISTINCT FROM 1::bigint OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy_record
    WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
      AND policy_record.polname IN (
        'Authenticated users can upload own repair images',
        'Authenticated users can delete own repair images'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Migration 130000 Storage policy markers are incomplete.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
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
      AND pg_catalog.pg_get_function_identity_arguments(function_record.oid) = ''
      AND pg_catalog.pg_get_userbyid(function_record.proowner) = 'postgres'
      AND NOT function_record.prosecdef
      AND function_record.proconfig = ARRAY['search_path=""']
      AND function_record.prorettype = 'trigger'::pg_catalog.regtype
      AND pg_catalog.md5(function_record.prosrc) =
          'b0559e204ecc97fcc5438bad0a833396'
  ) IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Exact maintenance barrier is not present.';
  END IF;
END;
$postinstall_gate$;

DROP TRIGGER block_repair_image_storage_writes_during_maintenance
ON storage.objects;
DROP FUNCTION repair_image_private.block_repair_image_storage_writes_during_maintenance();

DO $postcheck$
BEGIN
  IF pg_catalog.to_regprocedure(
       'repair_image_private.block_repair_image_storage_writes_during_maintenance()'
     ) IS NOT NULL OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_record
       WHERE trigger_record.tgrelid = 'storage.objects'::pg_catalog.regclass
         AND trigger_record.tgname =
             'block_repair_image_storage_writes_during_maintenance'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Post-install barrier removal failed.';
  END IF;
END;
$postcheck$;

COMMIT;
