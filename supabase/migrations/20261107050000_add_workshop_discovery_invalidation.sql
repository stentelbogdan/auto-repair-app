-- LOCAL REVIEW CANDIDATE. Preparation does not authorize installation.
-- TEST bstjobvvxxfqqwyjoimx only. No request data or identifiers in the signal.
-- Review realtime.send / receive policies in TEST before opening the review gate.
-- Reconciled with query-177 (SHA256 d111dd6383e165cb4ef5d3a82cf10218a3d23f8d98939bbac00d1414dbf873f9).
-- Deploy the compatible consumer accepting the managed technical UUID id.
-- Application input is {"v":1}; the managed send function may add "id".
BEGIN TRANSACTION READ WRITE;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
    OR current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
      IS DISTINCT FROM '7692131729119822239' THEN
    RAISE EXCEPTION 'BLOCKED_TEST_IDENTITY';
  END IF;
  IF current_setting('app.workshop_discovery_signal_review',true) IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'BLOCKED_DISCOVERY_SIGNAL_REVIEW_REQUIRED';
  END IF;
  IF pg_catalog.to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('realtime.topic()') IS NULL
    OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid=pg_catalog.to_regclass('realtime.messages') AND relrowsecurity)
    OR NOT pg_catalog.has_table_privilege('authenticated','realtime.messages','SELECT')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid=pg_catalog.to_regprocedure('public.get_workshop_discovery_counts(text,integer)')
        AND prosecdef AND proowner='postgres'::regrole)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='postgres' AND rolbypassrls)
    OR EXISTS (SELECT 1 FROM (VALUES ('repair_requests'),('repair_offers'),
      ('repair_request_discovery_locations'),('workshop_service_areas'),('profiles')) source(name)
      WHERE pg_catalog.to_regclass('public.'||source.name) IS NULL) THEN
    RAISE EXCEPTION 'BLOCKED_DISCOVERY_SIGNAL_DEPENDENCIES';
  END IF;
  IF pg_catalog.to_regprocedure('public.can_receive_workshop_discovery()') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.invalidate_workshop_discovery()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid='realtime.messages'::regclass AND polname LIKE 'workshop_discovery_%')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='zz_workshop_discovery_invalidate') THEN
    RAISE EXCEPTION 'BLOCKED_DISCOVERY_SIGNAL_ALREADY_EXISTS';
  END IF;
END;
$preflight$;

-- Only tests the caller's own role; no IDs/roles/rows are returned to subscribers.
CREATE FUNCTION public.can_receive_workshop_discovery()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $role$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles profile WHERE profile.id=auth.uid()
      AND coalesce(pg_catalog.to_jsonb(profile.role),'[]'::jsonb) @> '["workshop"]'::jsonb
  );
$role$;
ALTER FUNCTION public.can_receive_workshop_discovery() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_receive_workshop_discovery() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_receive_workshop_discovery() TO authenticated;

-- Additive, topic-scoped policies. Existing Admin/Customer/Chat rules stay intact.
-- Restrictive guards prevent a broader existing permissive policy from granting
-- receipt to another role or allowing browser publication on this topic.
-- Do not test messages.private here: Realtime's read-authorization probe can
-- insert a row with DEFAULT false. The sender and subscription use private=true;
-- exact topic, extension and caller role authorize the probe and receipt alike.
CREATE POLICY workshop_discovery_receive ON realtime.messages
AS PERMISSIVE FOR SELECT TO authenticated
USING (topic='workshop:discovery:v1' AND realtime.topic()=topic
  AND extension='broadcast' AND public.can_receive_workshop_discovery());
CREATE POLICY workshop_discovery_receive_guard ON realtime.messages
AS RESTRICTIVE FOR SELECT TO authenticated
USING (CASE WHEN topic='workshop:discovery:v1' OR realtime.topic()='workshop:discovery:v1'
  THEN topic='workshop:discovery:v1' AND realtime.topic()=topic
    AND extension='broadcast' AND public.can_receive_workshop_discovery()
  ELSE true END);
CREATE POLICY workshop_discovery_anon_guard ON realtime.messages
AS RESTRICTIVE FOR SELECT TO anon
USING (topic IS DISTINCT FROM 'workshop:discovery:v1'
  AND realtime.topic() IS DISTINCT FROM 'workshop:discovery:v1');
CREATE POLICY workshop_discovery_insert_guard ON realtime.messages
AS RESTRICTIVE FOR INSERT TO anon,authenticated
WITH CHECK (topic IS DISTINCT FROM 'workshop:discovery:v1'
  AND realtime.topic() IS DISTINCT FROM 'workshop:discovery:v1');
CREATE POLICY workshop_discovery_update_guard ON realtime.messages
AS RESTRICTIVE FOR UPDATE TO anon,authenticated
USING (topic IS DISTINCT FROM 'workshop:discovery:v1'
  AND realtime.topic() IS DISTINCT FROM 'workshop:discovery:v1')
WITH CHECK (topic IS DISTINCT FROM 'workshop:discovery:v1'
  AND realtime.topic() IS DISTINCT FROM 'workshop:discovery:v1');
CREATE POLICY workshop_discovery_delete_guard ON realtime.messages
AS RESTRICTIVE FOR DELETE TO anon,authenticated
USING (topic IS DISTINCT FROM 'workshop:discovery:v1'
  AND realtime.topic() IS DISTINCT FROM 'workshop:discovery:v1');

CREATE FUNCTION public.invalidate_workshop_discovery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $signal$
DECLARE
  previous_topic text := pg_catalog.current_setting('realtime.topic',true);
BEGIN
  -- Database Broadcast is transactional. No HTTP, no singleton/advisory lock,
  -- no client/area fan-out. All Services revalidate their own authorized counts.
  -- Per query-177's full installed definition, send() adds a technical UUID id and
  -- can catch errors internally as WARNING. Its void return does NOT confirm an
  -- INSERT or delivery; the outer handler below only catches propagated errors.
  BEGIN
    PERFORM realtime.send('{"v":1}'::jsonb,'invalidate','workshop:discovery:v1',true);
  EXCEPTION WHEN OTHERS THEN
    -- Best effort for errors propagated out of the managed function only.
    -- No SQLERRM or row data. This does not acknowledge delivery. Cancellation
    -- still propagates; runtime latency/managed send implementation need review.
    RAISE LOG 'WORKSHOP_DISCOVERY_SIGNAL_UNAVAILABLE';
  END;
  -- send() changes this transaction-local GUC. Restore the previous authorization
  -- context so subsequent Admin/Customer operations retain their own semantics.
  PERFORM pg_catalog.set_config('realtime.topic',coalesce(previous_topic,''),true);
  RETURN NULL;
END;
$signal$;
ALTER FUNCTION public.invalidate_workshop_discovery() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.invalidate_workshop_discovery() FROM PUBLIC,anon,authenticated,service_role;

-- One signal per statement, not per affected row. Repeated/nested statements
-- are coalesced by the consumer; there is no shared write lock for deduplication.
CREATE TRIGGER zz_workshop_discovery_invalidate
AFTER INSERT OR DELETE OR UPDATE OF status,service_type,request_type,target_workshop_id,accepted_offer_id
ON public.repair_requests FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_workshop_discovery();
CREATE TRIGGER zz_workshop_discovery_invalidate
AFTER INSERT OR UPDATE OR DELETE ON public.repair_request_discovery_locations
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_workshop_discovery();
CREATE TRIGGER zz_workshop_discovery_invalidate
AFTER INSERT OR UPDATE OR DELETE ON public.workshop_service_areas
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_workshop_discovery();
-- Discovery excludes requests already offered on by the current Service.
-- Read receipts/status-only offer updates do not change that exclusion.
CREATE TRIGGER zz_workshop_discovery_invalidate
AFTER INSERT OR DELETE OR UPDATE OF request_id,workshop_user_id ON public.repair_offers
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_workshop_discovery();
CREATE TRIGGER zz_workshop_discovery_invalidate
AFTER INSERT OR DELETE OR UPDATE OF role ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_workshop_discovery();

DO $postcheck$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_trigger
      WHERE tgname='zz_workshop_discovery_invalidate' AND tgenabled='O'
        AND tgfoid='public.invalidate_workshop_discovery()'::regprocedure) <> 5
    OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid='realtime.messages'::regclass
      AND polname LIKE 'workshop_discovery_%') <> 6
    OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE oid IN (
      'public.invalidate_workshop_discovery()'::regprocedure,'public.can_receive_workshop_discovery()'::regprocedure)
      AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']) <> 2
    OR pg_catalog.has_function_privilege('authenticated','public.invalidate_workshop_discovery()','EXECUTE')
    OR pg_catalog.has_function_privilege('anon','public.can_receive_workshop_discovery()','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated','public.can_receive_workshop_discovery()','EXECUTE') THEN
    RAISE EXCEPTION 'BLOCKED_DISCOVERY_SIGNAL_POSTCHECK';
  END IF;
END;
$postcheck$;
COMMIT;
