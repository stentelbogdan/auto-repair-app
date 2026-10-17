-- AutoRepair Marketplace
-- Aggregate LIVE inventory before repair-image migrations 20261003100000-130000.
-- READ ONLY: returns counts and byte totals only; it does not expose object paths.

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
      MESSAGE = 'LIVE repair-image inventory identity mismatch.';
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
    request_row.request_id,
    request_row.user_id,
    image_element.ordinality,
    image_element.image_value,
    pg_catalog.jsonb_typeof(image_element.image_value) AS element_kind
  FROM request_rows AS request_row
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(request_row.image_array)
    WITH ORDINALITY AS image_element(image_value, ordinality)
),
lexical AS (
  SELECT
    element.*,
    CASE
      WHEN element.element_kind = 'string' THEN element.image_value #>> '{}'
      ELSE NULL
    END AS string_value,
    CASE
      WHEN element.element_kind = 'object'
        THEN NULLIF(pg_catalog.btrim(element.image_value ->> 'path'), '')
      ELSE NULL
    END AS object_path,
    CASE
      WHEN element.element_kind = 'object'
        THEN NULLIF(pg_catalog.btrim(element.image_value ->> 'url'), '')
      ELSE NULL
    END AS object_url
  FROM elements AS element
),
raw_references AS (
  SELECT
    lexical.*,
    CASE
      WHEN lexical.element_kind = 'string'
       AND lexical.string_value !~* '^https://'
       AND lexical.string_value !~* '^data:'
        THEN NULLIF(pg_catalog.btrim(lexical.string_value), '')
      ELSE lexical.object_path
    END AS raw_path,
    CASE
      WHEN lexical.element_kind = 'string'
       AND lexical.string_value ~* '^https://'
        THEN NULLIF(pg_catalog.btrim(lexical.string_value), '')
      ELSE lexical.object_url
    END AS raw_url,
    (lexical.element_kind = 'string' AND lexical.string_value ~* '^data:') AS is_data_url,
    CASE
      WHEN lexical.element_kind = 'object' AND lexical.object_path IS NOT NULL
        THEN 'modern'
      WHEN lexical.element_kind = 'object' THEN 'legacy'
      WHEN lexical.element_kind = 'string' AND lexical.string_value ~* '^https://'
        THEN 'legacy'
      WHEN lexical.element_kind = 'string' THEN 'path_string'
      ELSE 'unsupported'
    END AS reference_format
  FROM lexical
),
normalized_parts AS (
  SELECT
    reference.*,
    CASE
      WHEN reference.raw_path IS NULL THEN NULL
      ELSE pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(reference.raw_path, '^repair-images/', ''),
        '%2f', '/', 'gi'
      )
    END AS path_from_path,
    CASE
      WHEN reference.raw_url IS NULL THEN NULL
      WHEN pg_catalog.lower(
        pg_catalog.left(
          pg_catalog.split_part(reference.raw_url, '?', 1),
          pg_catalog.length(constants.public_prefix)
        )
      ) = constants.public_prefix
      THEN pg_catalog.regexp_replace(
        pg_catalog.substr(
          pg_catalog.split_part(reference.raw_url, '?', 1),
          pg_catalog.length(constants.public_prefix) + 1
        ),
        '%2f', '/', 'gi'
      )
      ELSE NULL
    END AS path_from_url,
    constants.path_pattern
  FROM raw_references AS reference
  CROSS JOIN constants
),
classified AS (
  SELECT
    normalized.*,
    COALESCE(normalized.path_from_path, normalized.path_from_url) AS normalized_path,
    CASE
      WHEN normalized.is_data_url THEN 'IGNORED_DATA_URL'
      WHEN normalized.element_kind NOT IN ('object', 'string') THEN 'UNSUPPORTED_ELEMENT'
      WHEN normalized.raw_path IS NULL AND normalized.raw_url IS NULL THEN 'MISSING_PATH_AND_URL'
      WHEN normalized.raw_url IS NOT NULL AND normalized.path_from_url IS NULL THEN 'UNAPPROVED_URL'
      WHEN normalized.path_from_path IS NOT NULL
       AND normalized.path_from_url IS NOT NULL
       AND normalized.path_from_path IS DISTINCT FROM normalized.path_from_url
        THEN 'PATH_URL_MISMATCH'
      WHEN COALESCE(normalized.path_from_path, normalized.path_from_url)
           !~* normalized.path_pattern
        THEN 'INVALID_PATH'
      ELSE 'VALID'
    END AS classification
  FROM normalized_parts AS normalized
),
valid_references AS (
  SELECT * FROM classified WHERE classification = 'VALID'
),
storage_inventory AS (
  SELECT
    pg_catalog.count(*)::bigint AS object_count,
    COALESCE(
      pg_catalog.sum(
        CASE
          WHEN storage_object.metadata ->> 'size' ~ '^[0-9]+$'
            THEN (storage_object.metadata ->> 'size')::numeric
          ELSE 0::numeric
        END
      ),
      0::numeric
    ) AS total_bytes,
    pg_catalog.count(*) FILTER (
      WHERE storage_object.metadata ->> 'size' IS NULL
         OR storage_object.metadata ->> 'size' !~ '^[0-9]+$'
    )::bigint AS objects_without_numeric_size
  FROM storage.objects AS storage_object
  WHERE storage_object.bucket_id = 'repair-images'
),
reference_inventory AS (
  SELECT
    pg_catalog.count(*)::bigint AS active_reference_count,
    pg_catalog.count(DISTINCT valid_reference.normalized_path)::bigint
      AS distinct_referenced_path_count,
    pg_catalog.count(*) FILTER (
      WHERE valid_reference.reference_format = 'legacy'
    )::bigint AS legacy_reference_count,
    pg_catalog.count(*) FILTER (
      WHERE valid_reference.reference_format = 'modern'
    )::bigint AS modern_reference_count,
    pg_catalog.count(*) FILTER (
      WHERE valid_reference.reference_format = 'path_string'
    )::bigint AS path_string_reference_count
  FROM valid_references AS valid_reference
),
quality_inventory AS (
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE classified.classification = 'IGNORED_DATA_URL'
    )::bigint AS ignored_data_url_count,
    pg_catalog.count(*) FILTER (
      WHERE classified.classification NOT IN ('VALID', 'IGNORED_DATA_URL')
    )::bigint AS invalid_reference_count
  FROM classified
),
consistency_inventory AS (
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE storage_object.id IS NULL
    )::bigint AS missing_storage_object_count,
    pg_catalog.count(*) FILTER (
      WHERE storage_object.id IS NOT NULL
        AND storage_object.owner_id IS DISTINCT FROM valid_reference.user_id::text
    )::bigint AS storage_owner_mismatch_count
  FROM valid_references AS valid_reference
  LEFT JOIN storage.objects AS storage_object
    ON storage_object.bucket_id = 'repair-images'
   AND storage_object.name = valid_reference.normalized_path
)
SELECT
  'LIVE_INVENTORY_READY'::text AS inventory_status,
  (SELECT pg_catalog.count(*) FROM storage.buckets WHERE id = 'repair-images')::bigint
    AS repair_images_bucket_count,
  storage_inventory.object_count AS storage_object_count,
  storage_inventory.total_bytes AS storage_total_bytes,
  storage_inventory.objects_without_numeric_size,
  reference_inventory.active_reference_count,
  reference_inventory.distinct_referenced_path_count,
  reference_inventory.legacy_reference_count,
  reference_inventory.modern_reference_count,
  reference_inventory.path_string_reference_count,
  quality_inventory.ignored_data_url_count,
  quality_inventory.invalid_reference_count,
  consistency_inventory.missing_storage_object_count,
  consistency_inventory.storage_owner_mismatch_count
FROM storage_inventory
CROSS JOIN reference_inventory
CROSS JOIN quality_inventory
CROSS JOIN consistency_inventory;

ROLLBACK;
