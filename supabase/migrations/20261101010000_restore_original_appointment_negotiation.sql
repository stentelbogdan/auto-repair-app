-- LOCAL REVIEW CANDIDATE ONLY. TEST bstjobvvxxfqqwyjoimx; not installation authorization.
-- Only five existing definitions change. No new RPC, binding, table, policy or grant.
-- Baseline query-153; drift requires independent review. Keep a window without concurrent DDL.
BEGIN TRANSACTION READ WRITE;
DO $identity$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('transaction_read_only')<>'off'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
       IS DISTINCT FROM '7692131729119822239' THEN
    RAISE EXCEPTION 'BLOCKED_TEST_IDENTITY';
  END IF;
END;
$identity$;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('auth.uid()'))
     IS DISTINCT FROM 'cdef18c69c4f4cbbced2eaf81e628b49' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: uid'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.complete_repair_offer_selection_locked(uuid,uuid)'))
     IS DISTINCT FROM 'e120432ed49c644d8af7b91acbbdaef2' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: complete_repair_offer_selection_locked'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.create_appointment_notification()'))
     IS DISTINCT FROM '593e948a054c37730227dd8b5bc4d0a6' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: create_appointment_notification'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.customer_accept_workshop_appointment(uuid,timestamp with time zone)'))
     IS DISTINCT FROM 'c62e6267173abd1a8e7f0b8cad04d57d' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: customer_accept_workshop_appointment'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)'))
     IS DISTINCT FROM '4ff296f45f750f2961e64ecd848391a7' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: customer_propose_repair_appointment'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.enforce_repair_appointment_insert_authority()'))
     IS DISTINCT FROM '60a04535f5c3edfa87aa73b63963df5d' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: enforce_repair_appointment_insert_authority'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.finalize_customer_repair_offer(uuid,uuid)'))
     IS DISTINCT FROM 'a4e45b84b66864368d2a0ec287a998ea' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: finalize_customer_repair_offer'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.finalize_workshop_customer_proposal(uuid,uuid)'))
     IS DISTINCT FROM 'bfae5d207cf48708dc2c9b42c6d400ca' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: finalize_workshop_customer_proposal'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.prevent_appointment_for_inactive_request()'))
     IS DISTINCT FROM '301f80256acef44868dff9523cd7922d' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: prevent_appointment_for_inactive_request'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.prevent_direct_preaward_appointment_confirmation()'))
     IS DISTINCT FROM '85717b521c38f40015a5f04e72643130' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: prevent_direct_preaward_appointment_confirmation'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.prevent_workshop_appointment_slot_collision()'))
     IS DISTINCT FROM '905b98fa1afcc886970bafb6eea5328e' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: prevent_workshop_appointment_slot_collision'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.protect_preaward_appointment_proposal_authority()'))
     IS DISTINCT FROM 'a95cb049c100fdf57f558ff9c9f7a51a' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: protect_preaward_appointment_proposal_authority'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.protect_repair_appointment_identity()'))
     IS DISTINCT FROM '126fec5ded9c268f064c0d5cb129750f' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: protect_repair_appointment_identity'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.workshop_appointment_lifecycle_blocks_slot(text,text,uuid,uuid,uuid,uuid,text,uuid,uuid)'))
     IS DISTINCT FROM '7db60013780733c717606bfc021d2f68' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: workshop_appointment_lifecycle_blocks_slot'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)'))
     IS DISTINCT FROM 'f6fb02ab7e2a90570c06ea70ed97f0dc' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: workshop_propose_repair_appointment'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)'))
     IS DISTINCT FROM '20c8cbd529a263813f97a11a9edec16a' THEN RAISE EXCEPTION 'BLOCKED_CONTRACT_DRIFT: workshop_resolve_customer_appointment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND NOT proisstrict
    AND prokind='f' AND proconfig=ARRAY['search_path=""']::text[] AND prorettype='public.repair_appointments'::regtype AND NOT proretset) THEN
    RAISE EXCEPTION 'BLOCKED_FUNCTION_ATTRIBUTES: customer_propose_repair_appointment'; END IF;
  IF NOT has_function_privilege('authenticated','public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)','EXECUTE') OR has_function_privilege('service_role','public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid='public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'BLOCKED_RPC_ACL: customer_propose_repair_appointment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND NOT proisstrict
    AND prokind='f' AND proconfig=ARRAY['search_path=""']::text[] AND prorettype='public.repair_appointments'::regtype AND NOT proretset) THEN
    RAISE EXCEPTION 'BLOCKED_FUNCTION_ATTRIBUTES: workshop_propose_repair_appointment'; END IF;
  IF NOT has_function_privilege('authenticated','public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)','EXECUTE') OR has_function_privilege('service_role','public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid='public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'BLOCKED_RPC_ACL: workshop_propose_repair_appointment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.customer_accept_workshop_appointment(uuid,timestamp with time zone)'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND NOT proisstrict
    AND prokind='f' AND proconfig=ARRAY['search_path=""']::text[] AND prorettype='public.repair_appointments'::regtype AND NOT proretset) THEN
    RAISE EXCEPTION 'BLOCKED_FUNCTION_ATTRIBUTES: customer_accept_workshop_appointment'; END IF;
  IF NOT has_function_privilege('authenticated','public.customer_accept_workshop_appointment(uuid,timestamp with time zone)','EXECUTE')
    OR has_function_privilege('anon','public.customer_accept_workshop_appointment(uuid,timestamp with time zone)','EXECUTE') OR has_function_privilege('service_role','public.customer_accept_workshop_appointment(uuid,timestamp with time zone)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid='public.customer_accept_workshop_appointment(uuid,timestamp with time zone)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'BLOCKED_RPC_ACL: customer_accept_workshop_appointment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND NOT proisstrict
    AND prokind='f' AND proconfig=ARRAY['search_path=""']::text[] AND prorettype='public.repair_appointments'::regtype AND NOT proretset) THEN
    RAISE EXCEPTION 'BLOCKED_FUNCTION_ATTRIBUTES: workshop_resolve_customer_appointment'; END IF;
  IF NOT has_function_privilege('authenticated','public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)','EXECUTE')
    OR has_function_privilege('anon','public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)','EXECUTE') OR has_function_privilege('service_role','public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)','EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid='public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'BLOCKED_RPC_ACL: workshop_resolve_customer_appointment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.prevent_appointment_for_inactive_request()'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND NOT proisstrict
    AND prokind='f' AND proconfig=ARRAY['search_path=public']::text[] AND prorettype='trigger'::regtype AND NOT proretset) THEN
    RAISE EXCEPTION 'BLOCKED_FUNCTION_ATTRIBUTES: prevent_appointment_for_inactive_request'; END IF;
  IF has_table_privilege('authenticated','public.repair_appointments','UPDATE')
    OR has_any_column_privilege('authenticated','public.repair_appointments','UPDATE') THEN
    RAISE EXCEPTION 'BLOCKED_DIRECT_APPOINTMENT_WRITE_PRIVILEGE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass
    AND tgname='appointment_notification_trigger' AND tgenabled='O' AND tgfoid='public.create_appointment_notification()'::regprocedure
    AND md5(pg_get_triggerdef(oid,true))='401b15e82ee065eabc68eb643d1905c5') THEN
    RAISE EXCEPTION 'BLOCKED_TRIGGER_CONTRACT: appointment_notification_trigger'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass
    AND tgname='enforce_repair_appointment_insert_authority_trigger' AND tgenabled='O' AND tgfoid='public.enforce_repair_appointment_insert_authority()'::regprocedure
    AND md5(pg_get_triggerdef(oid,true))='dca05a4fcbbc32d948d50de16712519c') THEN
    RAISE EXCEPTION 'BLOCKED_TRIGGER_CONTRACT: enforce_repair_appointment_insert_authority_trigger'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass
    AND tgname='prevent_appointment_for_inactive_request_trigger' AND tgenabled='O' AND tgfoid='public.prevent_appointment_for_inactive_request()'::regprocedure
    AND md5(pg_get_triggerdef(oid,true))='2146b1a2af94860a1414d1ebfe92f3ca') THEN
    RAISE EXCEPTION 'BLOCKED_TRIGGER_CONTRACT: prevent_appointment_for_inactive_request_trigger'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass
    AND tgname='prevent_direct_preaward_appointment_confirmation_trigger' AND tgenabled='O' AND tgfoid='public.prevent_direct_preaward_appointment_confirmation()'::regprocedure
    AND md5(pg_get_triggerdef(oid,true))='0f514c81f38410f65fe24a34c2909ca9') THEN
    RAISE EXCEPTION 'BLOCKED_TRIGGER_CONTRACT: prevent_direct_preaward_appointment_confirmation_trigger'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass
    AND tgname='prevent_workshop_appointment_slot_collision_trigger' AND tgenabled='O' AND tgfoid='public.prevent_workshop_appointment_slot_collision()'::regprocedure
    AND md5(pg_get_triggerdef(oid,true))='48bed06f3bc6643fee6e4638bfaf4b6f') THEN
    RAISE EXCEPTION 'BLOCKED_TRIGGER_CONTRACT: prevent_workshop_appointment_slot_collision_trigger'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass
    AND tgname='protect_preaward_appointment_proposal_authority_trigger' AND tgenabled='O' AND tgfoid='public.protect_preaward_appointment_proposal_authority()'::regprocedure
    AND md5(pg_get_triggerdef(oid,true))='0f088aa2e9efcf644cc2748f9a13a7c0') THEN
    RAISE EXCEPTION 'BLOCKED_TRIGGER_CONTRACT: protect_preaward_appointment_proposal_authority_trigger'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass
    AND tgname='protect_repair_appointment_identity_trigger' AND tgenabled='O' AND tgfoid='public.protect_repair_appointment_identity()'::regprocedure
    AND md5(pg_get_triggerdef(oid,true))='6917923980527ce968b39cd45fa17e60') THEN
    RAISE EXCEPTION 'BLOCKED_TRIGGER_CONTRACT: protect_repair_appointment_identity_trigger'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid='public.repair_appointments'::regclass AND NOT tgisinternal) <> 7 THEN
    RAISE EXCEPTION 'BLOCKED_EXTRA_APPOINTMENT_TRIGGER'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname='customer_propose_repair_appointment') <> 1 THEN
    RAISE EXCEPTION 'BLOCKED_RPC_OVERLOAD: customer_propose_repair_appointment'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname='workshop_propose_repair_appointment') <> 1 THEN
    RAISE EXCEPTION 'BLOCKED_RPC_OVERLOAD: workshop_propose_repair_appointment'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname='customer_accept_workshop_appointment') <> 1 THEN
    RAISE EXCEPTION 'BLOCKED_RPC_OVERLOAD: customer_accept_workshop_appointment'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname='workshop_resolve_customer_appointment') <> 1 THEN
    RAISE EXCEPTION 'BLOCKED_RPC_OVERLOAD: workshop_resolve_customer_appointment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=to_regclass('public.repair_appointments_offer_id_unique_idx')
    AND indrelid='public.repair_appointments'::regclass AND indisvalid AND indisready AND indisunique
    AND md5(pg_get_indexdef(indexrelid))='a78ce2f8a3065d259b3bf462cdcf2090') THEN
    RAISE EXCEPTION 'BLOCKED_UNIQUE_INDEX: repair_appointments_offer_id_unique_idx'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=to_regclass('public.repair_appointments_unique_active_slot')
    AND indrelid='public.repair_appointments'::regclass AND indisvalid AND indisready AND indisunique
    AND md5(pg_get_indexdef(indexrelid))='650838e71110d4c406adea554e70452e') THEN
    RAISE EXCEPTION 'BLOCKED_UNIQUE_INDEX: repair_appointments_unique_active_slot'; END IF;
  PERFORM pg_catalog.set_config('autorepair.negotiation_contract_baseline',(WITH evidence AS (
 SELECT 'function:'||p.oid::text AS key,
   (pg_catalog.to_jsonb(p) - 'prosrc')::text || coalesce(CASE WHEN p.proname IN ('customer_propose_repair_appointment','workshop_propose_repair_appointment','customer_accept_workshop_appointment','workshop_resolve_customer_appointment','prevent_appointment_for_inactive_request') THEN NULL ELSE md5(p.prosrc) END,'') AS value
 FROM pg_catalog.pg_proc p WHERE p.oid IN (SELECT to_regprocedure(x) FROM unnest(ARRAY['auth.uid()','public.complete_repair_offer_selection_locked(uuid,uuid)','public.create_appointment_notification()','public.customer_accept_workshop_appointment(uuid,timestamp with time zone)','public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)','public.enforce_repair_appointment_insert_authority()','public.finalize_customer_repair_offer(uuid,uuid)','public.finalize_workshop_customer_proposal(uuid,uuid)','public.prevent_appointment_for_inactive_request()','public.prevent_direct_preaward_appointment_confirmation()','public.prevent_workshop_appointment_slot_collision()','public.protect_preaward_appointment_proposal_authority()','public.protect_repair_appointment_identity()','public.workshop_appointment_lifecycle_blocks_slot(text,text,uuid,uuid,uuid,uuid,text,uuid,uuid)','public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)','public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)']) x)
 UNION ALL SELECT 'relation:'||c.oid::text,jsonb_build_object('owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)::text
 FROM pg_catalog.pg_class c WHERE c.oid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'trigger:'||t.oid::text,pg_catalog.to_jsonb(t)::text FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'policy:'||p.oid::text,pg_catalog.to_jsonb(p)::text FROM pg_catalog.pg_policy p WHERE p.polrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'constraint:'||c.oid::text,pg_catalog.to_jsonb(c)::text FROM pg_catalog.pg_constraint c WHERE c.conrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'index:'||i.indexrelid::text,pg_catalog.to_jsonb(i)::text FROM pg_catalog.pg_index i WHERE i.indrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
) SELECT md5(string_agg(key||':'||value,E'\n' ORDER BY key)) FROM evidence),true);
END;
$preflight$;
-- BEGIN REPLACEMENT customer_propose_repair_appointment
CREATE OR REPLACE FUNCTION public.customer_propose_repair_appointment(p_appointment_id uuid, p_expected_updated_at timestamp with time zone, p_proposed_date date, p_proposed_time text, p_handover_method text, p_pickup_address text, p_customer_note text)
 RETURNS repair_appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  candidate_request_id uuid;
  candidate_offer_id uuid;
  locked_request public.repair_requests%rowtype;
  locked_offer public.repair_offers%rowtype;
  locked_appointment public.repair_appointments%rowtype;
  result public.repair_appointments%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_updated_at is null or p_proposed_date is null
    or nullif(btrim(p_proposed_time), '') is null
    or p_handover_method is null
    or p_handover_method not in ('customer_dropoff', 'workshop_pickup') then
    raise exception 'Invalid appointment proposal' using errcode = '22023';
  end if;

  select request_id, offer_id into candidate_request_id, candidate_offer_id
  from public.repair_appointments where id = p_appointment_id;
  if not found or candidate_offer_id is null then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;

  select * into locked_request from public.repair_requests
  where id = candidate_request_id for update;
  select * into locked_offer from public.repair_offers
  where id = candidate_offer_id for update;
  select * into locked_appointment from public.repair_appointments
  where id = p_appointment_id for update;

  if locked_request.id is null or locked_offer.id is null or locked_appointment.id is null
    or locked_appointment.request_id is distinct from locked_request.id
    or locked_appointment.offer_id is distinct from locked_offer.id
    or locked_offer.request_id is distinct from locked_request.id
    or locked_appointment.customer_id is distinct from locked_request.user_id
    or locked_appointment.workshop_id is distinct from locked_offer.workshop_user_id
    or actor_id is distinct from locked_request.user_id then
    raise exception 'Customer is not authorized for this appointment' using errcode = '42501';
  end if;
  if locked_appointment.updated_at is distinct from p_expected_updated_at then
    raise exception 'Appointment changed concurrently' using errcode = '40001';
  end if;
  if locked_appointment.status not in ('requested','customer_proposed','workshop_proposed','declined') then
    raise exception 'Appointment cannot receive a customer proposal from its current state' using errcode = '55000';
  end if;

  -- Participant/version checks and request -> offer -> appointment locks precede this.
  -- Same-status proposals must also be eligible.
  if not coalesce((
    (locked_request.status = 'open' and locked_request.accepted_offer_id is null
      and locked_offer.status = 'pending')
    or (locked_request.status in ('matched','in_progress')
      and locked_request.accepted_offer_id = locked_offer.id
      and locked_offer.status = 'accepted')
  ), false) then
    raise exception 'Appointment negotiation is not eligible for this request and offer' using errcode='55000';
  end if;
  update public.repair_appointments
  set proposed_date = p_proposed_date,
      proposed_time = btrim(p_proposed_time),
      handover_method = p_handover_method,
      pickup_address = case when p_handover_method='workshop_pickup' then nullif(btrim(p_pickup_address),'') else null end,
      customer_note = nullif(btrim(p_customer_note),''),
      workshop_note = null,
      status = 'customer_proposed',
      updated_at = clock_timestamp()
  where id = p_appointment_id
  returning * into result;
  return result;
end;
$function$;
-- END REPLACEMENT customer_propose_repair_appointment

-- BEGIN REPLACEMENT workshop_propose_repair_appointment
CREATE OR REPLACE FUNCTION public.workshop_propose_repair_appointment(p_appointment_id uuid, p_expected_updated_at timestamp with time zone, p_proposed_date date, p_proposed_time text, p_workshop_note text)
 RETURNS repair_appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  candidate_request_id uuid;
  candidate_offer_id uuid;
  locked_request public.repair_requests%rowtype;
  locked_offer public.repair_offers%rowtype;
  locked_appointment public.repair_appointments%rowtype;
  result public.repair_appointments%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_expected_updated_at is null or p_proposed_date is null or nullif(btrim(p_proposed_time),'') is null then
    raise exception 'Invalid appointment proposal' using errcode='22023';
  end if;
  select request_id, offer_id into candidate_request_id, candidate_offer_id
  from public.repair_appointments where id=p_appointment_id;
  if not found or candidate_offer_id is null then raise exception 'Appointment not found' using errcode='P0002'; end if;
  select * into locked_request from public.repair_requests where id=candidate_request_id for update;
  select * into locked_offer from public.repair_offers where id=candidate_offer_id for update;
  select * into locked_appointment from public.repair_appointments where id=p_appointment_id for update;
  if locked_request.id is null or locked_offer.id is null or locked_appointment.id is null
    or locked_appointment.request_id is distinct from locked_request.id
    or locked_appointment.offer_id is distinct from locked_offer.id
    or locked_offer.request_id is distinct from locked_request.id
    or locked_appointment.customer_id is distinct from locked_request.user_id
    or locked_appointment.workshop_id is distinct from locked_offer.workshop_user_id
    or actor_id is distinct from locked_offer.workshop_user_id then
    raise exception 'Workshop is not authorized for this appointment' using errcode='42501';
  end if;
  if locked_appointment.updated_at is distinct from p_expected_updated_at then
    raise exception 'Appointment changed concurrently' using errcode='40001';
  end if;
  if locked_appointment.status not in ('requested','customer_proposed','workshop_proposed','declined') then
    raise exception 'Appointment cannot receive a workshop proposal from its current state' using errcode='55000';
  end if;
  -- Participant/version checks and request -> offer -> appointment locks precede this.
  -- Same-status proposals must also be eligible.
  if not coalesce((
    (locked_request.status = 'open' and locked_request.accepted_offer_id is null
      and locked_offer.status = 'pending')
    or (locked_request.status in ('matched','in_progress')
      and locked_request.accepted_offer_id = locked_offer.id
      and locked_offer.status = 'accepted')
  ), false) then
    raise exception 'Appointment negotiation is not eligible for this request and offer' using errcode='55000';
  end if;
  update public.repair_appointments
  set proposed_date=p_proposed_date, proposed_time=btrim(p_proposed_time),
      workshop_note=nullif(btrim(p_workshop_note),''), status='workshop_proposed',
      updated_at=clock_timestamp()
  where id=p_appointment_id returning * into result;
  return result;
end;
$function$;
-- END REPLACEMENT workshop_propose_repair_appointment

-- BEGIN REPLACEMENT customer_accept_workshop_appointment
CREATE OR REPLACE FUNCTION public.customer_accept_workshop_appointment(p_appointment_id uuid, p_expected_updated_at timestamp with time zone)
 RETURNS repair_appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid(); candidate_request_id uuid; candidate_offer_id uuid;
  locked_request public.repair_requests%rowtype; locked_offer public.repair_offers%rowtype;
  locked_appointment public.repair_appointments%rowtype; result public.repair_appointments%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_expected_updated_at is null then raise exception 'Expected appointment version is required' using errcode='22023'; end if;
  select request_id,offer_id into candidate_request_id,candidate_offer_id from public.repair_appointments where id=p_appointment_id;
  if not found or candidate_offer_id is null then raise exception 'Appointment not found' using errcode='P0002'; end if;
  select * into locked_request from public.repair_requests where id=candidate_request_id for update;
  select * into locked_offer from public.repair_offers where id=candidate_offer_id for update;
  select * into locked_appointment from public.repair_appointments where id=p_appointment_id for update;
  if locked_request.id is null or locked_offer.id is null or locked_appointment.id is null
    or locked_appointment.request_id is distinct from locked_request.id or locked_appointment.offer_id is distinct from locked_offer.id
    or locked_offer.request_id is distinct from locked_request.id or locked_appointment.customer_id is distinct from locked_request.user_id
    or locked_appointment.workshop_id is distinct from locked_offer.workshop_user_id or actor_id is distinct from locked_request.user_id then
    raise exception 'Customer is not authorized for this appointment' using errcode='42501';
  end if;
  if locked_appointment.updated_at is distinct from p_expected_updated_at then raise exception 'Appointment changed concurrently' using errcode='40001'; end if;
  if locked_appointment.status is distinct from 'workshop_proposed' then raise exception 'Only a workshop proposal can be accepted by the customer' using errcode='55000'; end if;
  -- Participant/version checks and request -> offer -> appointment locks precede this.
  -- Same-status proposals must also be eligible.
  if not coalesce((
    (locked_request.status = 'open' and locked_request.accepted_offer_id is null
      and locked_offer.status = 'pending')
    or (locked_request.status in ('matched','in_progress')
      and locked_request.accepted_offer_id = locked_offer.id
      and locked_offer.status = 'accepted')
  ), false) then
    raise exception 'Appointment negotiation is not eligible for this request and offer' using errcode='55000';
  end if;
  if locked_request.status = 'open' then
    raise exception 'Initial confirmation must use the existing offer finalizer' using errcode='55000';
  end if;
  if locked_appointment.proposed_date is null
    or nullif(btrim(locked_appointment.proposed_time),'') is null then
    raise exception 'Exact workshop proposal is required' using errcode='22023';
  end if;
  update public.repair_appointments set status='confirmed',
      appointment_date=locked_appointment.proposed_date,
      appointment_time=locked_appointment.proposed_time,
      proposed_date=null, proposed_time=null, workshop_note=null,
      updated_at=clock_timestamp()
  where id=p_appointment_id returning * into result;
  return result;
end;
$function$;
-- END REPLACEMENT customer_accept_workshop_appointment

-- BEGIN REPLACEMENT workshop_resolve_customer_appointment
CREATE OR REPLACE FUNCTION public.workshop_resolve_customer_appointment(p_appointment_id uuid, p_expected_updated_at timestamp with time zone, p_decision text)
 RETURNS repair_appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid(); candidate_request_id uuid; candidate_offer_id uuid;
  locked_request public.repair_requests%rowtype; locked_offer public.repair_offers%rowtype;
  locked_appointment public.repair_appointments%rowtype; result public.repair_appointments%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_expected_updated_at is null or p_decision is null or p_decision not in ('confirmed','declined') then raise exception 'Invalid workshop decision' using errcode='22023'; end if;
  select request_id,offer_id into candidate_request_id,candidate_offer_id from public.repair_appointments where id=p_appointment_id;
  if not found or candidate_offer_id is null then raise exception 'Appointment not found' using errcode='P0002'; end if;
  select * into locked_request from public.repair_requests where id=candidate_request_id for update;
  select * into locked_offer from public.repair_offers where id=candidate_offer_id for update;
  select * into locked_appointment from public.repair_appointments where id=p_appointment_id for update;
  if locked_request.id is null or locked_offer.id is null or locked_appointment.id is null
    or locked_appointment.request_id is distinct from locked_request.id or locked_appointment.offer_id is distinct from locked_offer.id
    or locked_offer.request_id is distinct from locked_request.id or locked_appointment.customer_id is distinct from locked_request.user_id
    or locked_appointment.workshop_id is distinct from locked_offer.workshop_user_id or actor_id is distinct from locked_offer.workshop_user_id then
    raise exception 'Workshop is not authorized for this appointment' using errcode='42501';
  end if;
  if locked_appointment.updated_at is distinct from p_expected_updated_at then raise exception 'Appointment changed concurrently' using errcode='40001'; end if;
  if locked_appointment.status is distinct from 'customer_proposed' then raise exception 'Only a customer proposal can be resolved by the workshop' using errcode='55000'; end if;
  -- Participant/version checks and request -> offer -> appointment locks precede this.
  -- Same-status proposals must also be eligible.
  if not coalesce((
    (locked_request.status = 'open' and locked_request.accepted_offer_id is null
      and locked_offer.status = 'pending')
    or (locked_request.status in ('matched','in_progress')
      and locked_request.accepted_offer_id = locked_offer.id
      and locked_offer.status = 'accepted')
  ), false) then
    raise exception 'Appointment negotiation is not eligible for this request and offer' using errcode='55000';
  end if;
  if p_decision = 'confirmed' and locked_request.status = 'open' then
    raise exception 'Initial confirmation must use the existing offer finalizer' using errcode='55000';
  end if;
  if p_decision = 'confirmed' and (locked_appointment.proposed_date is null
    or nullif(btrim(locked_appointment.proposed_time),'') is null) then
    raise exception 'Exact customer proposal is required' using errcode='22023';
  end if;
  update public.repair_appointments
  set status=p_decision,
      appointment_date=case when p_decision='confirmed' then coalesce(proposed_date,appointment_date) else appointment_date end,
      appointment_time=case when p_decision='confirmed' then coalesce(proposed_time,appointment_time) else appointment_time end,
      proposed_date=case when p_decision='confirmed' then null else proposed_date end,
      proposed_time=case when p_decision='confirmed' then null else proposed_time end,
      workshop_note=case when p_decision='confirmed' then null else workshop_note end,
      updated_at=clock_timestamp()
  where id=p_appointment_id returning * into result;
  return result;
end;
$function$;
-- END REPLACEMENT workshop_resolve_customer_appointment

-- BEGIN REPLACEMENT prevent_appointment_for_inactive_request
CREATE OR REPLACE FUNCTION public.prevent_appointment_for_inactive_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.repair_requests%rowtype;
  v_offer public.repair_offers%rowtype;
begin
  -- Preserve cancellation/retirement by existing lifecycle operations.
  -- RPCs validate eligibility separately even for a declined decision.
  if tg_op = 'UPDATE' and new.status not in (
    'requested','customer_proposed','workshop_proposed','confirmed'
  ) then return new; end if;

  if tg_op = 'INSERT' then
    select * into v_request from public.repair_requests where id=new.request_id for update;
  else
    begin
      select * into v_request from public.repair_requests where id=new.request_id for update nowait;
    exception when lock_not_available then
      raise exception 'Cererea este actualizată. Reîncearcă operația.';
    end;
  end if;
  if not found then raise exception 'Cererea nu a fost găsită.'; end if;

  -- No new offer lock here: original RPCs already lock request -> offer -> appointment.
  select * into v_offer from public.repair_offers where id=new.offer_id;
  if not found or v_offer.request_id is distinct from v_request.id
    or new.customer_id is distinct from v_request.user_id
    or new.workshop_id is distinct from v_offer.workshop_user_id then
    raise exception 'Programarea nu corespunde cererii și ofertei.' using errcode='42501';
  end if;

  -- No same-status shortcut. RPCs always SET status, firing the existing binding.
  if not coalesce((
    (v_request.status='open' and v_request.accepted_offer_id is null and v_offer.status='pending')
    or (tg_op='UPDATE' and v_request.status in ('matched','in_progress')
      and v_request.accepted_offer_id=v_offer.id and v_offer.status='accepted')
  ), false) then
    raise exception 'Programarea nu poate fi creată sau confirmată pentru această cerere.';
  end if;
  return new;
end;
$function$;
-- END REPLACEMENT prevent_appointment_for_inactive_request

DO $postcheck$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)'::regprocedure)
    IS DISTINCT FROM '3b7d0582d3a4ebb5164faea78b60d6f9' THEN RAISE EXCEPTION 'BLOCKED_REPLACEMENT_BODY: customer_propose_repair_appointment'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)'::regprocedure)
    IS DISTINCT FROM '189612cdd23f27cd3fe9c11c31c2d35d' THEN RAISE EXCEPTION 'BLOCKED_REPLACEMENT_BODY: workshop_propose_repair_appointment'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.customer_accept_workshop_appointment(uuid,timestamp with time zone)'::regprocedure)
    IS DISTINCT FROM '66c9a938a0ad0e635ad149269f1d6635' THEN RAISE EXCEPTION 'BLOCKED_REPLACEMENT_BODY: customer_accept_workshop_appointment'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)'::regprocedure)
    IS DISTINCT FROM 'cb2ef03b8e3601ebfb6d90cc7bfd31c9' THEN RAISE EXCEPTION 'BLOCKED_REPLACEMENT_BODY: workshop_resolve_customer_appointment'; END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid='public.prevent_appointment_for_inactive_request()'::regprocedure)
    IS DISTINCT FROM '4da09acd182ef625ae1fc41d5fbe7a55' THEN RAISE EXCEPTION 'BLOCKED_REPLACEMENT_BODY: prevent_appointment_for_inactive_request'; END IF;
  IF (WITH evidence AS (
 SELECT 'function:'||p.oid::text AS key,
   (pg_catalog.to_jsonb(p) - 'prosrc')::text || coalesce(CASE WHEN p.proname IN ('customer_propose_repair_appointment','workshop_propose_repair_appointment','customer_accept_workshop_appointment','workshop_resolve_customer_appointment','prevent_appointment_for_inactive_request') THEN NULL ELSE md5(p.prosrc) END,'') AS value
 FROM pg_catalog.pg_proc p WHERE p.oid IN (SELECT to_regprocedure(x) FROM unnest(ARRAY['auth.uid()','public.complete_repair_offer_selection_locked(uuid,uuid)','public.create_appointment_notification()','public.customer_accept_workshop_appointment(uuid,timestamp with time zone)','public.customer_propose_repair_appointment(uuid,timestamp with time zone,date,text,text,text,text)','public.enforce_repair_appointment_insert_authority()','public.finalize_customer_repair_offer(uuid,uuid)','public.finalize_workshop_customer_proposal(uuid,uuid)','public.prevent_appointment_for_inactive_request()','public.prevent_direct_preaward_appointment_confirmation()','public.prevent_workshop_appointment_slot_collision()','public.protect_preaward_appointment_proposal_authority()','public.protect_repair_appointment_identity()','public.workshop_appointment_lifecycle_blocks_slot(text,text,uuid,uuid,uuid,uuid,text,uuid,uuid)','public.workshop_propose_repair_appointment(uuid,timestamp with time zone,date,text,text)','public.workshop_resolve_customer_appointment(uuid,timestamp with time zone,text)']) x)
 UNION ALL SELECT 'relation:'||c.oid::text,jsonb_build_object('owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)::text
 FROM pg_catalog.pg_class c WHERE c.oid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'trigger:'||t.oid::text,pg_catalog.to_jsonb(t)::text FROM pg_catalog.pg_trigger t WHERE t.tgrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'policy:'||p.oid::text,pg_catalog.to_jsonb(p)::text FROM pg_catalog.pg_policy p WHERE p.polrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'constraint:'||c.oid::text,pg_catalog.to_jsonb(c)::text FROM pg_catalog.pg_constraint c WHERE c.conrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
 UNION ALL SELECT 'index:'||i.indexrelid::text,pg_catalog.to_jsonb(i)::text FROM pg_catalog.pg_index i WHERE i.indrelid IN ('public.repair_requests'::regclass,'public.repair_offers'::regclass,'public.repair_appointments'::regclass)
) SELECT md5(string_agg(key||':'||value,E'\n' ORDER BY key)) FROM evidence) IS DISTINCT FROM current_setting('autorepair.negotiation_contract_baseline') THEN
    RAISE EXCEPTION 'BLOCKED_EXISTING_CONTRACT_CHANGED'; END IF;
END;
$postcheck$;
SELECT 'PRECOMMIT_NEGOTIATION_RESTORATION_CHECKED' AS result;
COMMIT;
