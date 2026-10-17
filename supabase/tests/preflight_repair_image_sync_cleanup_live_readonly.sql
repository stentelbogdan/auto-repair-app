-- AutoRepair Marketplace
-- LIVE preflight for repair-image registry, trusted upload, synchronization, and cleanup.
-- READ ONLY: run manually and review every row before any installation.

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
      MESSAGE = 'LIVE repair-image preflight identity mismatch.';
  END IF;
END;
$identity_gate$;

WITH
constants AS (
  SELECT
    'https://ouoiykudvcoqbkybkqvs.supabase.co/storage/v1/object/public/repair-images/'::text AS public_prefix,
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]*$'::text AS path_pattern
),
request_rows AS (
  SELECT
    rr.id AS request_id,
    rr.user_id,
    rr.images,
    pg_catalog.jsonb_typeof(rr.images) AS images_kind,
    CASE
      WHEN rr.images IS NULL OR rr.images = 'null'::jsonb THEN '[]'::jsonb
      WHEN pg_catalog.jsonb_typeof(rr.images) = 'array' THEN rr.images
      WHEN pg_catalog.jsonb_typeof(rr.images) IN ('object', 'string')
        THEN pg_catalog.jsonb_build_array(rr.images)
      ELSE '[]'::jsonb
    END AS image_array
  FROM public.repair_requests AS rr
),
elements AS (
  SELECT
    r.request_id,
    r.user_id,
    e.ordinality,
    e.image_value,
    pg_catalog.jsonb_typeof(e.image_value) AS element_kind
  FROM request_rows AS r
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(r.image_array)
    WITH ORDINALITY AS e(image_value, ordinality)
),
lexical AS (
  SELECT
    e.*,
    CASE
      WHEN e.element_kind = 'string' THEN e.image_value #>> '{}'
      ELSE NULL
    END AS string_value,
    CASE
      WHEN e.element_kind = 'object' THEN NULLIF(pg_catalog.btrim(e.image_value ->> 'path'), '')
      ELSE NULL
    END AS object_path,
    CASE
      WHEN e.element_kind = 'object' THEN NULLIF(pg_catalog.btrim(e.image_value ->> 'url'), '')
      ELSE NULL
    END AS object_url
  FROM elements AS e
),
raw_references AS (
  SELECT
    l.*,
    CASE
      WHEN l.element_kind = 'string'
       AND l.string_value !~* '^https://'
       AND l.string_value !~* '^data:'
        THEN NULLIF(pg_catalog.btrim(l.string_value), '')
      ELSE l.object_path
    END AS raw_path,
    CASE
      WHEN l.element_kind = 'string' AND l.string_value ~* '^https://'
        THEN NULLIF(pg_catalog.btrim(l.string_value), '')
      ELSE l.object_url
    END AS raw_url,
    (l.element_kind = 'string' AND l.string_value ~* '^data:') AS is_data_url,
    CASE
      WHEN l.element_kind = 'object' AND l.object_path IS NOT NULL THEN 'modern_object'
      WHEN l.element_kind = 'object' THEN 'legacy_object'
      WHEN l.element_kind = 'string' AND l.string_value ~* '^https://' THEN 'legacy_url_string'
      WHEN l.element_kind = 'string' THEN 'path_string'
      ELSE 'unsupported'
    END AS reference_format
  FROM lexical AS l
),
normalized_parts AS (
  SELECT
    r.*,
    CASE
      WHEN r.raw_path IS NULL THEN NULL
      ELSE pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(r.raw_path, '^repair-images/', ''),
        '%2f', '/', 'gi'
      )
    END AS path_from_path,
    CASE
      WHEN r.raw_url IS NULL THEN NULL
      WHEN pg_catalog.lower(
        pg_catalog.left(
          pg_catalog.split_part(r.raw_url, '?', 1),
          pg_catalog.length(c.public_prefix)
        )
      ) = c.public_prefix
      THEN pg_catalog.regexp_replace(
        pg_catalog.substr(
          pg_catalog.split_part(r.raw_url, '?', 1),
          pg_catalog.length(c.public_prefix) + 1
        ),
        '%2f', '/', 'gi'
      )
      ELSE NULL
    END AS path_from_url,
    c.path_pattern,
    c.public_prefix
  FROM raw_references AS r
  CROSS JOIN constants AS c
),
classified AS (
  SELECT
    n.*,
    COALESCE(n.path_from_path, n.path_from_url) AS normalized_path,
    CASE
      WHEN n.is_data_url THEN 'IGNORED_DATA_URL'
      WHEN n.element_kind NOT IN ('object', 'string') THEN 'UNSUPPORTED_ELEMENT'
      WHEN n.raw_path IS NULL AND n.raw_url IS NULL THEN 'MISSING_PATH_AND_URL'
      WHEN n.raw_url IS NOT NULL AND n.path_from_url IS NULL THEN 'UNAPPROVED_URL'
      WHEN n.path_from_path IS NOT NULL
       AND n.path_from_url IS NOT NULL
       AND n.path_from_path IS DISTINCT FROM n.path_from_url THEN 'PATH_URL_MISMATCH'
      WHEN COALESCE(n.path_from_path, n.path_from_url) !~* n.path_pattern
        THEN 'INVALID_PATH'
      ELSE 'VALID'
    END AS classification
  FROM normalized_parts AS n
),
valid_references AS (
  SELECT *
  FROM classified
  WHERE classification = 'VALID'
),
reference_storage AS (
  SELECT
    v.*,
    so.name AS storage_name,
    so.owner_id AS storage_owner_id
  FROM valid_references AS v
  LEFT JOIN storage.objects AS so
    ON so.bucket_id = 'repair-images'
   AND so.name = v.normalized_path
),
function_collisions AS (
  SELECT pg_catalog.count(*)::bigint AS collision_count
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE (n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)) IN (
    ('public', 'normalize_repair_image_storage_reference', 'p_reference text, p_reference_kind text, p_expected_host text'),
    ('public', 'extract_repair_image_storage_references', 'p_images jsonb, p_expected_host text'),
    ('public', 'reserve_repair_image_upload', 'p_file_extension text'),
    ('public', 'can_upload_reserved_repair_image', 'p_object_path text'),
    ('public', 'confirm_repair_image_upload', 'p_object_path text, p_lease_id uuid'),
    ('public', 'abandon_repair_image_upload', 'p_object_path text, p_lease_id uuid'),
    ('public', 'claim_repair_image_deletions', 'p_limit integer, p_claim_ttl interval'),
    ('public', 'complete_repair_image_deletion', 'p_object_path text, p_claim_id uuid, p_deleted boolean, p_error text'),
    ('repair_image_private', 'expected_storage_host', ''),
    ('repair_image_private', 'sync_repair_request_images', '')
  )
),
trigger_collisions AS (
  SELECT pg_catalog.count(*)::bigint AS collision_count
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'repair_requests'
    AND t.tgname IN (
      'sync_repair_request_images_after_insert',
      'sync_repair_request_images_after_update',
      'sync_repair_request_images_after_delete'
    )
),
checks AS (
  SELECT 1 AS check_no, 'live_identity'::text AS check_name,
         'PASS'::text AS status,
         'database=postgres,user=postgres,system_identifier=7623125441096521075'::text AS observed,
         'exact LIVE identity'::text AS expected
  UNION ALL
  SELECT 2, 'repair_requests_required_columns',
         CASE WHEN pg_catalog.count(*) = 3 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text,
         '3: id uuid, user_id uuid, images jsonb'
  FROM pg_catalog.pg_attribute AS a
  JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'repair_requests'
    AND a.attnum > 0 AND NOT a.attisdropped
    AND (a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)) IN (
      ('id', 'uuid'), ('user_id', 'uuid'), ('images', 'jsonb')
    )
  UNION ALL
  SELECT 3, 'repair_images_bucket',
         CASE WHEN pg_catalog.count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, 'exactly 1 bucket row'
  FROM storage.buckets WHERE id = 'repair-images'
  UNION ALL
  SELECT 4, 'required_roles',
         CASE WHEN pg_catalog.count(*) = 4 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, 'anon, authenticated, service_role, postgres'
  FROM pg_catalog.pg_roles
  WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
  UNION ALL
  SELECT 5, 'required_catalog_functions',
         CASE WHEN pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL
                   AND pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         (pg_catalog.to_regprocedure('auth.uid()') IS NOT NULL)::text || ',' ||
           (pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL)::text,
         'true,true'
  UNION ALL
  SELECT 6, 'private_registry_schema_absent',
         CASE WHEN pg_catalog.to_regnamespace('repair_image_private') IS NULL THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(pg_catalog.to_regnamespace('repair_image_private')::text, 'NULL'),
         'NULL'
  UNION ALL
  SELECT 7, 'repair_image_function_collisions',
         CASE WHEN collision_count = 0 THEN 'PASS' ELSE 'FAIL' END,
         collision_count::text, '0'
  FROM function_collisions
  UNION ALL
  SELECT 8, 'repair_request_sync_trigger_collisions',
         CASE WHEN collision_count = 0 THEN 'PASS' ELSE 'FAIL' END,
         collision_count::text, '0'
  FROM trigger_collisions
  UNION ALL
  SELECT 9, 'new_storage_upload_policy_absent',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM pg_catalog.pg_policy AS p
  JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects'
    AND p.polname = 'Authenticated users can upload reserved repair images'
  UNION ALL
  SELECT 10, 'unexpected_authenticated_delete_policies',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM pg_catalog.pg_policy AS p
  JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects'
    AND p.polcmd IN ('d', '*')
    AND p.polname <> 'Authenticated users can delete own repair images'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p.polroles) AS policy_role(role_oid)
      WHERE policy_role.role_oid = 0::oid
         OR pg_catalog.pg_get_userbyid(policy_role.role_oid)
              IN ('anon', 'authenticated')
    )
  UNION ALL
  SELECT 11, 'unsupported_images_container_types',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM request_rows
  WHERE images IS NOT NULL AND images <> 'null'::jsonb
    AND images_kind NOT IN ('array', 'object', 'string')
  UNION ALL
  SELECT 12, 'unusable_image_references',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM classified
  WHERE classification NOT IN ('VALID', 'IGNORED_DATA_URL')
  UNION ALL
  SELECT 13, 'normalized_storage_references', 'INFO',
         pg_catalog.count(*)::text, 'review against historical inventory'
  FROM valid_references
  UNION ALL
  SELECT 14, 'legacy_normalized_references', 'INFO',
         pg_catalog.count(*)::text, 'historical checkpoint: 133'
  FROM valid_references
  WHERE reference_format IN ('legacy_object', 'legacy_url_string')
  UNION ALL
  SELECT 15, 'modern_normalized_references', 'INFO',
         pg_catalog.count(*)::text, 'historical checkpoint: 74'
  FROM valid_references
  WHERE reference_format = 'modern_object'
  UNION ALL
  SELECT 16, 'ignored_data_urls', 'INFO',
         pg_catalog.count(*)::text, 'review explicitly; normalizer intentionally ignores these'
  FROM classified WHERE classification = 'IGNORED_DATA_URL'
  UNION ALL
  SELECT 17, 'referenced_storage_objects_missing',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM reference_storage WHERE storage_name IS NULL
  UNION ALL
  SELECT 18, 'referenced_storage_owner_mismatches',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM reference_storage
  WHERE storage_name IS NOT NULL
    AND storage_owner_id IS DISTINCT FROM user_id::text
  UNION ALL
  SELECT 19, 'path_owner_folder_mismatches',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM valid_references
  WHERE pg_catalog.split_part(normalized_path, '/', 1) IS DISTINCT FROM user_id::text
  UNION ALL
  SELECT 20, 'paths_referenced_by_multiple_owners',
         CASE WHEN pg_catalog.count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         pg_catalog.count(*)::text, '0'
  FROM (
    SELECT normalized_path
    FROM valid_references
    GROUP BY normalized_path
    HAVING pg_catalog.count(DISTINCT user_id) > 1
  ) AS conflicts
)
SELECT check_no, check_name, status, observed, expected
FROM checks
ORDER BY check_no;

ROLLBACK;
