-- AutoRepair Marketplace
-- LIVE ONLY: temporary repair-images write barrier.
-- Review and run manually only during the approved maintenance window.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $identity_and_baseline$
DECLARE
  v_system_identifier text;
  v_upload_check text;
  v_delete_using text;
  v_expected_upload text;
  v_expected_delete text;
BEGIN
  SELECT control.system_identifier::text INTO v_system_identifier
  FROM pg_catalog.pg_control_system() AS control;

  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres'
     OR CURRENT_USER IS DISTINCT FROM 'postgres'
     OR v_system_identifier IS DISTINCT FROM '7623125441096521075'
     OR v_system_identifier = '7692131729119822239' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'LIVE repair-images maintenance identity mismatch.';
  END IF;

  IF pg_catalog.to_regclass('storage.objects') IS NULL
     OR pg_catalog.to_regclass('storage.buckets') IS NULL
     OR pg_catalog.to_regclass('public.repair_requests') IS NULL
     OR pg_catalog.to_regnamespace('repair_image_private') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Required LIVE objects are missing.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'repair-images')
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class AS relation_record
       WHERE relation_record.oid = 'storage.objects'::pg_catalog.regclass
         AND relation_record.relrowsecurity
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'repair-images bucket or storage.objects RLS is missing.';
  END IF;

  IF pg_catalog.to_regprocedure(
       'repair_image_private.block_repair_image_storage_writes_during_maintenance()'
     ) IS NOT NULL OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger AS trigger_record
       WHERE trigger_record.tgrelid = 'storage.objects'::pg_catalog.regclass
         AND trigger_record.tgname =
             'block_repair_image_storage_writes_during_maintenance'
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy_record
       WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
         AND policy_record.polname =
             'Authenticated users can upload reserved repair images'
     ) OR pg_catalog.to_regprocedure(
       'repair_image_private.sync_repair_request_images()'
     ) IS NOT NULL OR pg_catalog.to_regprocedure(
       'public.claim_repair_image_deletions(integer)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Barrier already exists or migration 130000 is present.';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy AS policy_record
    WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
      AND policy_record.polname =
          'Authenticated users can upload own repair images'
      AND policy_record.polcmd = 'a'
      AND policy_record.polpermissive
      AND policy_record.polroles = ARRAY[
        pg_catalog.to_regrole('authenticated')::oid
      ]
      AND policy_record.polqual IS NULL
  ) IS DISTINCT FROM 1::bigint OR (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy AS policy_record
    WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
      AND policy_record.polname =
          'Authenticated users can delete own repair images'
      AND policy_record.polcmd = 'd'
      AND policy_record.polpermissive
      AND policy_record.polroles = ARRAY[
        pg_catalog.to_regrole('authenticated')::oid
      ]
      AND policy_record.polwithcheck IS NULL
  ) IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Legacy repair-images policy metadata baseline mismatch.';
  END IF;

  SELECT pg_catalog.pg_get_expr(
    policy_record.polwithcheck, policy_record.polrelid
  ) INTO v_upload_check
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
    AND policy_record.polname =
        'Authenticated users can upload own repair images';

  SELECT pg_catalog.pg_get_expr(
    policy_record.polqual, policy_record.polrelid
  ) INTO v_delete_using
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
    AND policy_record.polname =
        'Authenticated users can delete own repair images';

  v_expected_upload := $expression$
    bucket_id = 'repair-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  $expression$;
  v_expected_delete := $expression$
    bucket_id = 'repair-images'
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = (select auth.uid())::text
  $expression$;

  IF pg_catalog.translate(pg_catalog.replace(pg_catalog.replace(
       pg_catalog.regexp_replace(pg_catalog.lower(v_upload_check), '\s+', '', 'g'),
       '::text', ''), 'select', ''), '()', '')
     IS DISTINCT FROM
     pg_catalog.translate(pg_catalog.replace(pg_catalog.replace(
       pg_catalog.regexp_replace(pg_catalog.lower(v_expected_upload), '\s+', '', 'g'),
       '::text', ''), 'select', ''), '()', '')
     OR pg_catalog.translate(pg_catalog.replace(pg_catalog.replace(
       pg_catalog.regexp_replace(pg_catalog.lower(v_delete_using), '\s+', '', 'g'),
       '::text', ''), 'select', ''), '()', '')
     IS DISTINCT FROM
     pg_catalog.translate(pg_catalog.replace(pg_catalog.replace(
       pg_catalog.regexp_replace(pg_catalog.lower(v_expected_delete), '\s+', '', 'g'),
       '::text', ''), 'select', ''), '()', '') THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Legacy repair-images policy expression baseline mismatch.';
  END IF;
END;
$identity_and_baseline$;

CREATE FUNCTION repair_image_private.block_repair_image_storage_writes_during_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.bucket_id = 'repair-images' THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'repair-images is temporarily read-only for maintenance.';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.bucket_id = 'repair-images'
       OR NEW.bucket_id = 'repair-images' THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'repair-images is temporarily read-only for maintenance.';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.bucket_id = 'repair-images' THEN
      RAISE EXCEPTION USING ERRCODE = '55000',
        MESSAGE = 'repair-images is temporarily read-only for maintenance.';
    END IF;
    RETURN OLD;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Unexpected Storage maintenance trigger operation.';
  END IF;
END;
$function$;

ALTER FUNCTION repair_image_private.block_repair_image_storage_writes_during_maintenance()
OWNER TO postgres;
REVOKE ALL ON FUNCTION
  repair_image_private.block_repair_image_storage_writes_during_maintenance()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER block_repair_image_storage_writes_during_maintenance
BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION
  repair_image_private.block_repair_image_storage_writes_during_maintenance();

DO $postcheck$
BEGIN
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
      AND function_record.proacl IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(function_record.proacl) AS acl
        WHERE acl.grantee <> function_record.proowner
      )
  ) IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Maintenance trigger contract mismatch.';
  END IF;
END;
$postcheck$;

COMMIT;
