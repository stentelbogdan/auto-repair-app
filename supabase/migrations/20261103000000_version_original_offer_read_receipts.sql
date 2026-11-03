-- Local preparation only. TEST bstjobvvxxfqqwyjoimx. No installation authorization.
BEGIN TRANSACTION READ WRITE;
DO $identity$ BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) IS DISTINCT FROM '7692131729119822239'
 OR current_setting('transaction_read_only')<>'off'
 THEN RAISE EXCEPTION 'BLOCKED_TEST_IDENTITY_OR_MODE'; END IF;
END; $identity$;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
-- Preserve the original request -> offer order; installation requires a quiet window.
LOCK TABLE public.repair_requests IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.repair_offers IN ACCESS EXCLUSIVE MODE;
DO $preflight$ DECLARE expected_function record; catalog_function record; BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.repair_offers'::regclass
   AND attname='read_state_version' AND NOT attisdropped)
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='version_repair_offer_read_state')
 THEN RAISE EXCEPTION 'BLOCKED_ALREADY_PRESENT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.repair_offers'::regclass
   AND relkind='r' AND relrowsecurity AND relowner='postgres'::regrole)
 OR NOT pg_catalog.has_table_privilege('authenticated','public.repair_offers','SELECT')
 OR pg_catalog.has_any_column_privilege('authenticated','public.repair_offers','UPDATE')
 THEN RAISE EXCEPTION 'BLOCKED_OFFER_ACL_RLS'; END IF;
 -- Exactly the three reviewed non-internal triggers, with the same bindings.
 IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_offers'::regclass AND NOT tgisinternal)<>3
 OR EXISTS (
   SELECT 1 FROM (VALUES
     ('guard_client_offer_identity_trigger','public.guard_client_offer_identity()',19,ARRAY[]::text[]),
     ('prevent_direct_offer_selection_updates_trigger','public.prevent_direct_offer_selection_updates()',19,ARRAY['status']::text[]),
     ('prevent_offer_for_inactive_request_trigger','public.prevent_offer_for_inactive_request()',23,ARRAY['request_id','status']::text[])
   ) expected(name,signature,bits,columns)
   LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid='public.repair_offers'::regclass AND t.tgname=expected.name
   WHERE t.oid IS NULL OR t.tgenabled<>'O' OR t.tgtype<>expected.bits OR t.tgisinternal
     OR t.tgfoid IS DISTINCT FROM pg_catalog.to_regprocedure(expected.signature)
     OR t.tgqual IS NOT NULL OR t.tgnargs<>0
     OR ARRAY(SELECT a.attname::text FROM pg_catalog.pg_attribute a
              WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[]) ORDER BY a.attname)
        IS DISTINCT FROM expected.columns
 ) THEN RAISE EXCEPTION 'BLOCKED_OFFER_TRIGGER_DRIFT'; END IF;
 FOR expected_function IN SELECT * FROM (VALUES
('auth.uid()','cdef18c69c4f4cbbced2eaf81e628b49','supabase_auth_admin',false,'s',false,'sql',NULL::text[]),
('public.guard_client_offer_identity()','0c66f933f710ddf378a8adc4a3fe9653','postgres',false,'v',false,'plpgsql',ARRAY['search_path=""']::text[]),
('public.mark_customer_repair_offers_read(uuid[])','ee4b6041f7cf5918f00c0fa369a06389','postgres',true,'v',false,'plpgsql',ARRAY['search_path=""']::text[]),
('public.mark_workshop_repair_offers_read(uuid[])','c23130f77b682210edfc66b01a7193c3','postgres',true,'v',false,'plpgsql',ARRAY['search_path=""']::text[]),
('public.prevent_direct_offer_selection_updates()','ab546bbb577a1acdff3ff9b8b287c71a','postgres',false,'v',false,'plpgsql',ARRAY['search_path=""']::text[]),
('public.prevent_offer_for_inactive_request()','202d6f2ce0e05da61c0e983ebe7dba59','postgres',true,'v',false,'plpgsql',ARRAY['search_path=public']::text[])) expected(signature,body_md5,owner,definer,volatility,expected_is_strict,language,config) LOOP
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(expected_function.signature)
    AND pg_catalog.md5(p.prosrc)=expected_function.body_md5 AND p.proowner=pg_catalog.to_regrole(expected_function.owner)
    AND p.prosecdef=expected_function.definer AND p.provolatile::text=expected_function.volatility AND p.proisstrict=expected_function.expected_is_strict
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname=expected_function.language)
    AND p.proconfig IS NOT DISTINCT FROM expected_function.config)
 THEN RAISE EXCEPTION 'BLOCKED_DEPENDENCY_DRIFT: %', expected_function.signature; END IF;
 END LOOP;
 FOR catalog_function IN SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('mark_customer_repair_offers_read','mark_workshop_repair_offers_read') LOOP
 IF catalog_function.pronargs<>1 OR catalog_function.proargtypes[0] <> 'uuid[]'::regtype OR catalog_function.proargnames IS DISTINCT FROM ARRAY['p_offer_ids']::text[]
 OR catalog_function.prorettype<>'bigint'::regtype OR catalog_function.proretset OR NOT catalog_function.prosecdef OR catalog_function.provolatile<>'v'
 OR catalog_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR NOT pg_catalog.has_function_privilege('authenticated',catalog_function.oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('anon',catalog_function.oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('service_role',catalog_function.oid,'EXECUTE')
 OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(catalog_function.proacl,pg_catalog.acldefault('f',catalog_function.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole::oid,'authenticated'::regrole::oid) OR (a.grantee='authenticated'::regrole::oid AND a.is_grantable))
 THEN RAISE EXCEPTION 'BLOCKED_ORIGINAL_RPC_METADATA'; END IF;
 END LOOP;
END; $preflight$;
DO $snapshot$ DECLARE value text; BEGIN
 SELECT md5(coalesce(string_agg(item,E'\n' ORDER BY item),'')) FROM (
 SELECT 'policy:'||to_jsonb(p)::text item FROM pg_catalog.pg_policy p
 WHERE polrelid IN ('public.repair_offers'::regclass,'public.repair_requests'::regclass)
 UNION ALL SELECT 'trigger:'||to_jsonb(t)::text FROM pg_catalog.pg_trigger t
 WHERE tgrelid IN ('public.repair_offers'::regclass,'public.repair_requests'::regclass)
 AND tgname<>'version_repair_offer_read_state_trigger'
 UNION ALL SELECT 'relation:'||oid::text||':'||relowner::text||':'||coalesce(relacl::text,'')||':'||relrowsecurity::text||':'||relforcerowsecurity::text
 FROM pg_catalog.pg_class WHERE oid IN ('public.repair_offers'::regclass,'public.repair_requests'::regclass)
 UNION ALL SELECT 'constraint:'||to_jsonb(c)::text FROM pg_catalog.pg_constraint c
 WHERE conrelid='public.repair_offers'::regclass AND conname<>'repair_offers_read_state_version_positive'
 UNION ALL SELECT 'column:'||attnum::text||':'||attname||':'||atttypid::text||':'||coalesce(attacl::text,'')
 FROM pg_catalog.pg_attribute WHERE attrelid='public.repair_offers'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'read_state_version'
) existing INTO value;
 PERFORM pg_catalog.set_config('autorepair.offer_read_before',value,true);
END; $snapshot$;

ALTER TABLE public.repair_offers ADD COLUMN read_state_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.repair_offers ADD CONSTRAINT repair_offers_read_state_version_positive CHECK (read_state_version>0);
-- Every UPDATE, including no-op resets and acknowledgements. No secondary UPDATE/recursion.
CREATE FUNCTION public.version_repair_offer_read_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $version$
BEGIN
 IF TG_OP='INSERT' THEN NEW.read_state_version:=1;
 ELSE NEW.read_state_version:=OLD.read_state_version+1; END IF;
 RETURN NEW;
END; $version$;
ALTER FUNCTION public.version_repair_offer_read_state() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.version_repair_offer_read_state() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER version_repair_offer_read_state_trigger BEFORE INSERT OR UPDATE ON public.repair_offers
FOR EACH ROW EXECUTE FUNCTION public.version_repair_offer_read_state();
-- Legacy calls cannot infer a displayed version. Fail closed, never return a misleading zero.
CREATE OR REPLACE FUNCTION public.mark_customer_repair_offers_read(p_offer_ids uuid[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $legacy$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication required.'; END IF;
 RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Observed offer versions are required.';
END; $legacy$;
-- Legacy calls cannot infer a displayed version. Fail closed, never return a misleading zero.
CREATE OR REPLACE FUNCTION public.mark_workshop_repair_offers_read(p_offer_ids uuid[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $legacy$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication required.'; END IF;
 RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Observed offer versions are required.';
END; $legacy$;
CREATE OR REPLACE FUNCTION public.mark_customer_repair_offers_read(p_offer_ids uuid[], p_expected_versions bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_requested bigint;
  v_owned bigint;
  v_updated bigint;
  v_request_ids uuid[];
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication required.'; end if;
  if p_offer_ids is null or array_position(p_offer_ids, null) is not null then
    raise exception using errcode='22004', message='Offer IDs must be non-null.';
  end if;
  if p_expected_versions is null
    or cardinality(p_offer_ids) <> cardinality(p_expected_versions)
    or (cardinality(p_offer_ids)>0 and (array_ndims(p_offer_ids)<>1 or array_ndims(p_expected_versions)<>1))
    or exists (select 1 from unnest(p_expected_versions) v where v is null or v < 1)
    or exists (select 1 from unnest(p_offer_ids,p_expected_versions) x(id,version)
               group by id having count(distinct version)>1) then
    raise exception using errcode='22023', message='One positive observed version per offer is required.';
  end if;
  select count(*) into v_requested from (select distinct id from unnest(p_offer_ids) id) requested;
  select coalesce(array_agg(distinct offer.request_id order by offer.request_id),'{}'::uuid[])
  into v_request_ids from public.repair_offers offer where offer.id=any(p_offer_ids);
  perform 1
  from public.repair_requests request
  where request.id=any(v_request_ids)
  order by request.id
  for update;
  perform 1 from public.repair_offers offer
  where offer.id=any(p_offer_ids) order by offer.id for update;
  if exists (select 1 from public.repair_offers offer
             where offer.id=any(p_offer_ids) and not (offer.request_id=any(v_request_ids))) then
    raise exception using errcode='40001', message='Offer ownership changed concurrently; retry the operation.';
  end if;
  select count(*) into v_owned
  from (select distinct id from unnest(p_offer_ids) id) requested
  join public.repair_offers offer on offer.id=requested.id
  join public.repair_requests request on request.id=offer.request_id
  where request.user_id=v_actor;
  if v_owned <> v_requested then raise exception using errcode='42501', message='One or more offers are not owned by the customer.'; end if;
  update public.repair_offers offer set customer_read_at=coalesce(offer.customer_read_at,pg_catalog.now())
  where offer.id=any(p_offer_ids) and offer.customer_read_at is null
    and exists (select 1 from unnest(p_offer_ids,p_expected_versions) observed(id,version)
                where observed.id=offer.id and observed.version=offer.read_state_version)
    and exists (select 1 from public.repair_requests request
                where request.id=offer.request_id and request.user_id=v_actor);
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_workshop_repair_offers_read(p_offer_ids uuid[], p_expected_versions bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_requested bigint;
  v_owned bigint;
  v_updated bigint;
  v_request_ids uuid[];
begin
  if v_actor is null then raise exception using errcode='42501', message='Authentication required.'; end if;
  if p_offer_ids is null or array_position(p_offer_ids, null) is not null then
    raise exception using errcode='22004', message='Offer IDs must be non-null.';
  end if;
  if p_expected_versions is null
    or cardinality(p_offer_ids) <> cardinality(p_expected_versions)
    or (cardinality(p_offer_ids)>0 and (array_ndims(p_offer_ids)<>1 or array_ndims(p_expected_versions)<>1))
    or exists (select 1 from unnest(p_expected_versions) v where v is null or v < 1)
    or exists (select 1 from unnest(p_offer_ids,p_expected_versions) x(id,version)
               group by id having count(distinct version)>1) then
    raise exception using errcode='22023', message='One positive observed version per offer is required.';
  end if;
  select count(*) into v_requested from (select distinct id from unnest(p_offer_ids) id) requested;
  select coalesce(array_agg(distinct offer.request_id order by offer.request_id),'{}'::uuid[])
  into v_request_ids from public.repair_offers offer where offer.id=any(p_offer_ids);
  perform 1
  from public.repair_requests request
  where request.id=any(v_request_ids)
  order by request.id
  for update;
  perform 1 from public.repair_offers offer
  where offer.id=any(p_offer_ids) order by offer.id for update;
  if exists (select 1 from public.repair_offers offer
             where offer.id=any(p_offer_ids) and not (offer.request_id=any(v_request_ids))) then
    raise exception using errcode='40001', message='Offer ownership changed concurrently; retry the operation.';
  end if;
  select count(*) into v_owned
  from (select distinct id from unnest(p_offer_ids) id) requested
  join public.repair_offers offer on offer.id=requested.id
  where offer.workshop_user_id=v_actor;
  if v_owned <> v_requested then raise exception using errcode='42501', message='One or more offers are not owned by the workshop.'; end if;
  update public.repair_offers offer set workshop_read_at=coalesce(offer.workshop_read_at,pg_catalog.now())
  where offer.id=any(p_offer_ids) and offer.workshop_read_at is null
    and exists (select 1 from unnest(p_offer_ids,p_expected_versions) observed(id,version)
                where observed.id=offer.id and observed.version=offer.read_state_version)
    and offer.workshop_user_id=v_actor;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;
ALTER FUNCTION public.mark_customer_repair_offers_read(uuid[],bigint[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_customer_repair_offers_read(uuid[],bigint[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_customer_repair_offers_read(uuid[],bigint[]) TO authenticated;
ALTER FUNCTION public.mark_workshop_repair_offers_read(uuid[],bigint[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_workshop_repair_offers_read(uuid[],bigint[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.mark_workshop_repair_offers_read(uuid[],bigint[]) TO authenticated;
DO $postcheck$ DECLARE value text; f record; BEGIN
 SELECT md5(coalesce(string_agg(item,E'\n' ORDER BY item),'')) FROM (
 SELECT 'policy:'||to_jsonb(p)::text item FROM pg_catalog.pg_policy p
 WHERE polrelid IN ('public.repair_offers'::regclass,'public.repair_requests'::regclass)
 UNION ALL SELECT 'trigger:'||to_jsonb(t)::text FROM pg_catalog.pg_trigger t
 WHERE tgrelid IN ('public.repair_offers'::regclass,'public.repair_requests'::regclass)
 AND tgname<>'version_repair_offer_read_state_trigger'
 UNION ALL SELECT 'relation:'||oid::text||':'||relowner::text||':'||coalesce(relacl::text,'')||':'||relrowsecurity::text||':'||relforcerowsecurity::text
 FROM pg_catalog.pg_class WHERE oid IN ('public.repair_offers'::regclass,'public.repair_requests'::regclass)
 UNION ALL SELECT 'constraint:'||to_jsonb(c)::text FROM pg_catalog.pg_constraint c
 WHERE conrelid='public.repair_offers'::regclass AND conname<>'repair_offers_read_state_version_positive'
 UNION ALL SELECT 'column:'||attnum::text||':'||attname||':'||atttypid::text||':'||coalesce(attacl::text,'')
 FROM pg_catalog.pg_attribute WHERE attrelid='public.repair_offers'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'read_state_version'
) existing INTO value;
 IF value IS DISTINCT FROM current_setting('autorepair.offer_read_before') THEN
 RAISE EXCEPTION 'BLOCKED_EXISTING_CONTRACT_DRIFT'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_attrdef d
 ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.repair_offers'::regclass AND a.attname='read_state_version'
 AND a.atttypid='bigint'::regtype AND a.attnotnull AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) IN ('1','1::bigint','''1''::bigint'))
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.repair_offers'::regclass
 AND conname='repair_offers_read_state_version_positive' AND contype='c' AND convalidated)
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.version_repair_offer_read_state()'::regprocedure
 AND proowner='postgres'::regrole AND NOT prosecdef AND proconfig=ARRAY['search_path=""']::text[])
 OR pg_catalog.has_function_privilege('authenticated','public.version_repair_offer_read_state()','EXECUTE')
 OR pg_catalog.has_function_privilege('anon','public.version_repair_offer_read_state()','EXECUTE')
 OR pg_catalog.has_function_privilege('service_role','public.version_repair_offer_read_state()','EXECUTE')
 THEN RAISE EXCEPTION 'BLOCKED_VERSION_METADATA'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_offers'::regclass
 AND tgname='version_repair_offer_read_state_trigger' AND tgenabled='O' AND tgtype=23 AND NOT tgisinternal)
 OR NOT pg_catalog.has_column_privilege('authenticated','public.repair_offers','read_state_version','SELECT')
 OR pg_catalog.has_column_privilege('authenticated','public.repair_offers','read_state_version','UPDATE')
 THEN RAISE EXCEPTION 'BLOCKED_VERSION_CONTRACT'; END IF;
 FOR f IN SELECT p.* FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('mark_customer_repair_offers_read','mark_workshop_repair_offers_read') LOOP
 IF f.proowner<>'postgres'::regrole OR NOT f.prosecdef OR f.provolatile<>'v' OR f.proretset
 OR f.prorettype<>'bigint'::regtype OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 OR NOT pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
 OR pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')
 OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
 WHERE a.grantee NOT IN ('postgres'::regrole::oid,'authenticated'::regrole::oid)
 OR (a.grantee='authenticated'::regrole::oid AND a.is_grantable))
 THEN RAISE EXCEPTION 'BLOCKED_RPC_SECURITY'; END IF;
 END LOOP;
END; $postcheck$;
SELECT 'PRECOMMIT_OFFER_READ_VERSION_CHECKED' AS result;
COMMIT;
