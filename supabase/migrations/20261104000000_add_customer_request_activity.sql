-- LOCAL REVIEW DRAFT. Not an approved installer. TEST only: bstjobvvxxfqqwyjoimx.
-- No business-row backfill: pre-existing edits cannot be reconstructed honestly.
BEGIN TRANSACTION READ WRITE;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $identity$
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
     OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
        IS DISTINCT FROM '7692131729119822239' THEN
    RAISE EXCEPTION 'BLOCKED_TEST_IDENTITY';
  END IF;
  -- Independent SQL review, real local concurrency tests, fresh TEST catalog and
  -- owner-channel policy review are required before preparing an installer.
  RAISE EXCEPTION 'BLOCKED_ACTIVITY_REVIEW_AND_PREFLIGHT_REQUIRED';
END;
$identity$;

DO $dependencies$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='postgres' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'BLOCKED_PRIVATE_DEFINER_RLS';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL
     OR to_regprocedure('realtime.topic()') IS NULL
     OR to_regprocedure('repair_image_private.expected_storage_host()') IS NULL
     OR to_regprocedure('public.extract_repair_image_storage_references(jsonb,text)') IS NULL
     OR to_regprocedure('public.complete_repair_image_deletion(text,uuid,boolean)') IS NULL
     OR to_regclass('repair_image_private.targeted_image_detachments') IS NULL
     OR to_regclass('repair_image_private.repair_image_objects') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('realtime.messages') IS NULL THEN
    RAISE EXCEPTION 'BLOCKED_ACTIVITY_DEPENDENCIES';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.repair_requests'::regclass AND tgname='sync_repair_request_images_after_update'
    AND tgfoid='repair_image_private.sync_repair_request_images()'::regprocedure
    AND tgenabled='O' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid='public.repair_requests'::regclass AND tgname='prevent_repair_request_edits_after_offer_trigger'
      AND tgfoid='public.prevent_repair_request_edits_after_offer()'::regprocedure
      AND tgenabled='O' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid='repair_image_private.repair_image_objects'::regclass
      AND tgfoid='repair_image_private.enforce_repair_image_object_transition()'::regprocedure
      AND tgenabled='O' AND NOT tgisinternal)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='realtime.messages'::regclass AND relrowsecurity)
  THEN RAISE EXCEPTION 'BLOCKED_ACTIVITY_GUARDS'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public'
        AND tablename IN ('repair_requests','repair_offers')) <> 2 THEN
    RAISE EXCEPTION 'BLOCKED_EXISTING_REALTIME_PUBLICATION';
  END IF;
END;
$dependencies$;

CREATE SCHEMA customer_request_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA customer_request_private FROM PUBLIC, anon, authenticated, service_role;
-- No FK: trusted request-row triggers are the only writers; the reader always
-- joins the current request AND its owner. No new locks on parent requests.
CREATE TABLE customer_request_private.request_edit_activity (
  request_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  last_relevant_activity_at timestamptz NOT NULL CHECK (pg_catalog.isfinite(last_relevant_activity_at))
);
ALTER TABLE customer_request_private.request_edit_activity OWNER TO postgres;
ALTER TABLE customer_request_private.request_edit_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_request_private.request_edit_activity FORCE ROW LEVEL SECURITY;
REVOKE ALL ON customer_request_private.request_edit_activity FROM PUBLIC, anon, authenticated, service_role;
-- Bounded install lock; avoids scanning all private receipts for every request.
-- No lifecycle/Storage behavior, FK, row, or existing index is changed.
CREATE INDEX customer_activity_targeted_receipt_idx
ON repair_image_private.targeted_image_detachments(request_id,owner_user_id)
INCLUDE(bucket_id,object_path,created_at)
WHERE deletion_authorized IS TRUE AND bucket_id='repair-images';

CREATE FUNCTION customer_request_private.record_saved_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  changed boolean := false;
  host text;
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM customer_request_private.request_edit_activity WHERE request_id=OLD.id;
    RETURN NULL;
  END IF;
  -- Identity changes are not activity; clear obsolete evidence instead of
  -- transferring it to another owner. Existing identity authorization is untouched.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    DELETE FROM customer_request_private.request_edit_activity WHERE request_id IN (OLD.id,NEW.id);
    RETURN NULL;
  END IF;
  IF coalesce(NEW.request_type,'repair')='direct_message' THEN RETURN NULL; END IF;
  changed := OLD.description IS DISTINCT FROM NEW.description;
  IF NOT changed AND OLD.images IS DISTINCT FROM NEW.images THEN
    host := repair_image_private.expected_storage_host();
    -- Same normalizer as the mandatory image synchronization trigger. Only a
    -- newly attached object counts, not URL metadata, reorder, or pure removal.
    SELECT EXISTS (
      SELECT x.object_path FROM public.extract_repair_image_storage_references(NEW.images,host) x
      EXCEPT
      SELECT x.object_path FROM public.extract_repair_image_storage_references(OLD.images,host) x
    ) INTO changed;
  END IF;
  IF changed THEN
    INSERT INTO customer_request_private.request_edit_activity AS a
      (request_id,owner_user_id,last_relevant_activity_at)
    VALUES(NEW.id,NEW.user_id,pg_catalog.clock_timestamp())
    ON CONFLICT(request_id) DO UPDATE
      SET owner_user_id=EXCLUDED.owner_user_id,
          last_relevant_activity_at=greatest(a.last_relevant_activity_at,EXCLUDED.last_relevant_activity_at);
  END IF;
  RETURN NULL;
END;
$function$;
ALTER FUNCTION customer_request_private.record_saved_activity() OWNER TO postgres;
REVOKE ALL ON FUNCTION customer_request_private.record_saved_activity() FROM PUBLIC,anon,authenticated,service_role;
-- AFTER, alphabetically after sync_repair_request_images_after_update. No change
-- to the image engine, object triggers, Storage checks or existing RPCs.
CREATE TRIGGER zz_customer_request_saved_activity
AFTER UPDATE OF id,user_id,description,images ON public.repair_requests
FOR EACH ROW EXECUTE FUNCTION customer_request_private.record_saved_activity();
CREATE TRIGGER zz_customer_request_activity_cleanup
AFTER DELETE ON public.repair_requests
FOR EACH ROW EXECUTE FUNCTION customer_request_private.record_saved_activity();

CREATE FUNCTION public.get_customer_requests_by_activity()
RETURNS TABLE(request_data jsonb,last_relevant_activity_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING errcode='42501',message='Authentication required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=actor
      AND coalesce(pg_catalog.to_jsonb(p.role),'[]'::jsonb) @> '["customer"]'::jsonb) THEN
    RETURN;
  END IF;
  -- One MVCC statement snapshot. No row/advisory locks, writes, receipt mutation
  -- or private paths in the result. Exact allowlist, never to_jsonb(request.*).
  RETURN QUERY
  SELECT pg_catalog.jsonb_build_object(
    'id',r.id,'user_id',r.user_id,'car_brand',r.car_brand,'car_model',r.car_model,
    'car_year',r.car_year,'city',r.city,'license_plate',r.license_plate,
    'damage_type',r.damage_type,'service_details',r.service_details,'service_type',r.service_type,
    'request_type',r.request_type,'target_workshop_id',r.target_workshop_id,
    'description',r.description,'images',r.images,'status',r.status,'accepted_offer_id',r.accepted_offer_id,
    'pickup_lat',r.pickup_lat,'pickup_lng',r.pickup_lng,'destination_lat',r.destination_lat,
    'destination_lng',r.destination_lng,'route_distance_meters',r.route_distance_meters,
    'route_duration_seconds',r.route_duration_seconds,'route_paths',r.route_paths,
    'towing_schedule_type',r.towing_schedule_type,'towing_requested_at',r.towing_requested_at,
    'towing_requested_timezone',r.towing_requested_timezone,'created_at',r.created_at,
    'offers_count',offers.total),
    greatest(r.created_at,a.last_relevant_activity_at,offers.latest,deleted.latest) AS activity
  FROM public.repair_requests r
  LEFT JOIN customer_request_private.request_edit_activity a
    ON a.request_id=r.id AND a.owner_user_id=r.user_id
  LEFT JOIN LATERAL (
    SELECT max(o.created_at) AS latest,count(*) AS total
    FROM public.repair_offers o WHERE o.request_id=r.id
  ) offers ON true
  LEFT JOIN LATERAL (
    SELECT max(o.deleted_at) AS latest
    FROM repair_image_private.targeted_image_detachments d
    JOIN repair_image_private.repair_image_objects o
      ON o.bucket_id=d.bucket_id AND o.object_path=d.object_path
      AND o.owner_user_id=d.owner_user_id
    WHERE d.request_id=r.id AND d.owner_user_id=r.user_id
      AND d.deletion_authorized IS TRUE AND d.bucket_id='repair-images'
      AND o.lifecycle_state='deleted' AND o.deleted_at IS NOT NULL
      AND pg_catalog.isfinite(o.deleted_at) AND o.deleted_at>=d.created_at AND o.row_version>0
  ) deleted ON true
  WHERE r.user_id=actor AND coalesce(r.request_type,'repair')<>'direct_message'
  ORDER BY activity DESC,r.created_at DESC,r.id DESC;
END;
$function$;
ALTER FUNCTION public.get_customer_requests_by_activity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_requests_by_activity() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_requests_by_activity() TO authenticated;

-- Receive-only invalidation for the CURRENT account, independent of the Admin
-- topic. Future server-only sender: topic customer:request-activity:v1:<owner uuid>,
-- event invalidate, payload {"v":1}. No table publication for private registries.
-- Existing request/offer Postgres Changes continue covering edits/create/offers.
-- Physical completion MUST be emitted after the server's strict verified result,
-- outside the deletion transaction. This migration deliberately adds NO sender
-- trigger, realtime.send(), registry write, or call from the deletion engine.
CREATE POLICY customer_request_activity_receive ON realtime.messages
AS PERMISSIVE FOR SELECT TO authenticated
USING (topic='customer:request-activity:v1:'||auth.uid()::text
  AND realtime.topic()=topic AND extension='broadcast' AND private IS TRUE AND auth.uid() IS NOT NULL);
CREATE POLICY customer_request_activity_receive_guard ON realtime.messages
AS RESTRICTIVE FOR SELECT TO authenticated
USING (CASE WHEN topic LIKE 'customer:request-activity:v1:%' OR realtime.topic() LIKE 'customer:request-activity:v1:%'
  THEN topic='customer:request-activity:v1:'||auth.uid()::text
    AND realtime.topic()=topic AND extension='broadcast' AND private IS TRUE AND auth.uid() IS NOT NULL
  ELSE true END);
CREATE POLICY customer_request_activity_anon_guard ON realtime.messages
AS RESTRICTIVE FOR SELECT TO anon
USING (coalesce(topic,'') NOT LIKE 'customer:request-activity:v1:%'
  AND coalesce(realtime.topic(),'') NOT LIKE 'customer:request-activity:v1:%');
CREATE POLICY customer_request_activity_insert_guard ON realtime.messages
AS RESTRICTIVE FOR INSERT TO anon,authenticated
WITH CHECK (coalesce(topic,'') NOT LIKE 'customer:request-activity:v1:%'
  AND coalesce(realtime.topic(),'') NOT LIKE 'customer:request-activity:v1:%');
CREATE POLICY customer_request_activity_update_guard ON realtime.messages
AS RESTRICTIVE FOR UPDATE TO anon,authenticated
USING (coalesce(topic,'') NOT LIKE 'customer:request-activity:v1:%'
  AND coalesce(realtime.topic(),'') NOT LIKE 'customer:request-activity:v1:%')
WITH CHECK (coalesce(topic,'') NOT LIKE 'customer:request-activity:v1:%'
  AND coalesce(realtime.topic(),'') NOT LIKE 'customer:request-activity:v1:%');
CREATE POLICY customer_request_activity_delete_guard ON realtime.messages
AS RESTRICTIVE FOR DELETE TO anon,authenticated
USING (coalesce(topic,'') NOT LIKE 'customer:request-activity:v1:%'
  AND coalesce(realtime.topic(),'') NOT LIKE 'customer:request-activity:v1:%');

DO $postcheck$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid='customer_request_private.request_edit_activity'::regclass
      AND c.relrowsecurity AND c.relforcerowsecurity AND c.relowner='postgres'::regrole)
    OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(
      (SELECT c.relacl FROM pg_catalog.pg_class c WHERE c.oid='customer_request_private.request_edit_activity'::regclass)) x
      WHERE x.grantee<>'postgres'::regrole)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid='public.get_customer_requests_by_activity()'::regprocedure
        AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='s'
        AND p.proconfig=ARRAY['search_path=""']
        AND pg_catalog.pg_get_function_result(p.oid)='TABLE(request_data jsonb, last_relevant_activity_at timestamp with time zone)')
    OR pg_catalog.has_function_privilege('anon','public.get_customer_requests_by_activity()','EXECUTE')
    OR pg_catalog.has_function_privilege('service_role','public.get_customer_requests_by_activity()','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated','public.get_customer_requests_by_activity()','EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(
      (SELECT coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)) FROM pg_catalog.pg_proc p
       WHERE p.oid='public.get_customer_requests_by_activity()'::regprocedure)) x
      WHERE x.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole))
    OR pg_catalog.has_schema_privilege('anon','customer_request_private','USAGE')
    OR pg_catalog.has_schema_privilege('authenticated','customer_request_private','USAGE')
    OR pg_catalog.has_schema_privilege('service_role','customer_request_private','USAGE')
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid='public.repair_requests'::regclass
          AND t.tgname IN ('zz_customer_request_saved_activity','zz_customer_request_activity_cleanup')
          AND t.tgenabled='O' AND NOT t.tgisinternal
          AND t.tgfoid='customer_request_private.record_saved_activity()'::regprocedure)<>2
    OR (SELECT count(*) FROM pg_catalog.pg_policy p
        WHERE p.polrelid='realtime.messages'::regclass
          AND p.polname IN ('customer_request_activity_receive','customer_request_activity_receive_guard',
            'customer_request_activity_anon_guard','customer_request_activity_insert_guard',
            'customer_request_activity_update_guard','customer_request_activity_delete_guard'))<>6
  THEN RAISE EXCEPTION 'BLOCKED_ACTIVITY_POSTCHECK'; END IF;
END;
$postcheck$;
COMMIT;
