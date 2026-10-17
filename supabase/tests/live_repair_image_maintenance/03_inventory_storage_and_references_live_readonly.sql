-- AutoRepair Marketplace: aggregate LIVE maintenance snapshot.
-- Strictly READ ONLY; returns no user data or object paths.

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
      MESSAGE = 'LIVE maintenance inventory identity mismatch.';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.extract_repair_image_storage_references(jsonb,text)'
     ) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'Reference normalizer is not installed.';
  END IF;
END;
$identity_gate$;

WITH normalized_references AS (
  SELECT DISTINCT
    request.id AS request_id,
    request.user_id,
    reference.object_path
  FROM public.repair_requests AS request
  CROSS JOIN LATERAL public.extract_repair_image_storage_references(
    request.images, 'ouoiykudvcoqbkybkqvs.supabase.co'
  ) AS reference
), storage_aggregate AS (
  SELECT
    pg_catalog.count(*)::bigint AS object_count,
    COALESCE(pg_catalog.sum(
      CASE WHEN storage_object.metadata ->> 'size' ~ '^[0-9]+$'
        THEN (storage_object.metadata ->> 'size')::bigint ELSE 0 END
    ), 0)::bigint AS total_bytes,
    pg_catalog.md5(COALESCE(pg_catalog.string_agg(
      storage_object.name || '|' || storage_object.id::text || '|' ||
      COALESCE(storage_object.updated_at::text, ''),
      E'\n' ORDER BY storage_object.name COLLATE "C"
    ), '')) AS snapshot_hash
  FROM storage.objects AS storage_object
  WHERE storage_object.bucket_id = 'repair-images'
), reference_aggregate AS (
  SELECT pg_catalog.count(*)::bigint AS reference_count,
         pg_catalog.count(DISTINCT object_path)::bigint AS distinct_path_count
  FROM normalized_references
), integrity_aggregate AS (
  SELECT
    pg_catalog.count(*) FILTER (WHERE storage_object.id IS NULL)::bigint
      AS missing_storage_count,
    pg_catalog.count(*) FILTER (
      WHERE storage_object.id IS NOT NULL
        AND storage_object.owner_id IS DISTINCT FROM reference.user_id::text
    )::bigint AS owner_mismatch_count
  FROM normalized_references AS reference
  LEFT JOIN storage.objects AS storage_object
    ON storage_object.bucket_id = 'repair-images'
   AND storage_object.name = reference.object_path
), unreferenced_aggregate AS (
  SELECT pg_catalog.count(*)::bigint AS unreferenced_storage_count
  FROM storage.objects AS storage_object
  LEFT JOIN normalized_references AS reference
    ON reference.object_path = storage_object.name
  WHERE storage_object.bucket_id = 'repair-images'
    AND reference.object_path IS NULL
), lock_aggregate AS (
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE lock_record.granted AND lock_record.mode IN (
        'RowExclusiveLock', 'ShareRowExclusiveLock',
        'ExclusiveLock', 'AccessExclusiveLock'
      )
    )::bigint AS granted_write_capable_lock_count,
    pg_catalog.count(*) FILTER (WHERE NOT lock_record.granted)::bigint
      AS waiting_lock_count
  FROM pg_catalog.pg_locks AS lock_record
  WHERE lock_record.pid <> pg_catalog.pg_backend_pid()
    AND lock_record.relation IN (
      'storage.objects'::pg_catalog.regclass,
      'public.repair_requests'::pg_catalog.regclass
    )
), barrier_aggregate AS (
  SELECT pg_catalog.count(*) FILTER (
           WHERE trigger_record.tgname =
             'block_repair_image_storage_writes_during_maintenance'
             AND NOT trigger_record.tgisinternal
             AND trigger_record.tgenabled = 'O'
             AND trigger_record.tgtype = 31
         )::bigint AS barrier_trigger_count
  FROM pg_catalog.pg_trigger AS trigger_record
  WHERE trigger_record.tgrelid = 'storage.objects'::pg_catalog.regclass
), policy_aggregate AS (
  SELECT pg_catalog.count(*)::bigint AS all_storage_policy_count
  FROM pg_catalog.pg_policy AS policy_record
  WHERE policy_record.polrelid = 'storage.objects'::pg_catalog.regclass
)
SELECT metric, value, interpretation
FROM (
  SELECT 1, 'storage_object_count'::text, object_count::text AS value,
    'repair-images rows in storage.objects'::text AS interpretation
  FROM storage_aggregate
  UNION ALL SELECT 2, 'storage_total_bytes', total_bytes::text,
    'sum of numeric metadata.size values' FROM storage_aggregate
  UNION ALL SELECT 3, 'storage_snapshot_hash', snapshot_hash,
    'MD5 of ordered name/id/updated_at metadata; compare snapshots only'
    FROM storage_aggregate
  UNION ALL SELECT 4, 'active_reference_count', reference_count::text,
    'normalized request-to-image references' FROM reference_aggregate
  UNION ALL SELECT 5, 'distinct_referenced_path_count', distinct_path_count::text,
    'distinct normalized paths' FROM reference_aggregate
  UNION ALL SELECT 6, 'missing_storage_count', missing_storage_count::text,
    'must be 0 before migration' FROM integrity_aggregate
  UNION ALL SELECT 7, 'owner_mismatch_count', owner_mismatch_count::text,
    'must be 0 before migration' FROM integrity_aggregate
  UNION ALL SELECT 8, 'unreferenced_storage_count',
    unreferenced_storage_count::text,
    'informational; does not authorize deletion' FROM unreferenced_aggregate
  UNION ALL SELECT 9, 'granted_write_capable_lock_count',
    granted_write_capable_lock_count::text,
    'must be interpreted with operational drain checks' FROM lock_aggregate
  UNION ALL SELECT 10, 'waiting_lock_count', waiting_lock_count::text,
    'must be 0 before migration' FROM lock_aggregate
  UNION ALL SELECT 11, 'barrier_trigger_count', barrier_trigger_count::text,
    'expected 1 while barrier is active' FROM barrier_aggregate
  UNION ALL SELECT 12, 'all_storage_policy_count', all_storage_policy_count::text,
    'inventory only; other bucket policies remain intact' FROM policy_aggregate
) AS metrics(metric_order, metric, value, interpretation)
ORDER BY metric_order;

ROLLBACK;
