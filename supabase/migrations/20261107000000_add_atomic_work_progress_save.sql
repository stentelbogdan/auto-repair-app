-- LOCAL REVIEW ONLY. Not installed by this preparation.
-- TEST: bstjobvvxxfqqwyjoimx / 7692131729119822239.
-- Evidence: query-169, SHA256 48479f773a744a6987d7a911ea809c52267b6b8f48b0bfc3416cb41ee8242e26.
-- Adds one RPC; existing RLS, triggers, Storage and notification contracts stay intact.
begin transaction read write;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
begin
  if current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres' or session_user is distinct from 'postgres'
    or (select system_identifier::text from pg_catalog.pg_control_system())
      is distinct from '7692131729119822239' then
    raise exception 'BLOCKED_TEST_IDENTITY';
  end if;
  if exists (select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_work_progress_update') then
    raise exception 'BLOCKED_PROGRESS_RPC_ALREADY_EXISTS';
  end if;
  if pg_catalog.to_regprocedure('auth.uid()') is null
    or pg_catalog.to_regclass('public.repair_requests') is null
    or pg_catalog.to_regclass('public.repair_offers') is null
    or pg_catalog.to_regclass('public.work_progress_updates') is null
    or not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid='public.work_progress_updates'::pg_catalog.regclass
        and a.attname='images' and a.atttypid='jsonb'::pg_catalog.regtype and not a.attisdropped)
  then
    raise exception 'BLOCKED_PROGRESS_DEPENDENCIES';
  end if;
end;
$preflight$;

create function public.save_work_progress_update(
  p_request_id uuid,
  p_status text,
  p_message text,
  p_images jsonb
)
returns table(id uuid, status text)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  workshop_id uuid := auth.uid();
  locked_request public.repair_requests%rowtype;
  locked_offer public.repair_offers%rowtype;
  progress_values public.work_progress_updates%rowtype;
  saved_progress_id uuid;
  saved_request public.repair_requests%rowtype;
  next_status public.repair_requests.status%type;
  category text;
  stage text := case when p_status='Gata' then 'Ready' else p_status end;
  allowed_stages text[];
begin
  if workshop_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if not exists (select 1 from public.profiles profile
    where profile.id=workshop_id
      and coalesce(pg_catalog.to_jsonb(profile.role),'[]'::jsonb) @> '["workshop"]'::jsonb) then
    raise exception 'Workshop role required' using errcode='42501';
  end if;

  -- Same request -> offer order as the existing negotiation/finalizer contracts.
  -- Include authority in the first lock lookup to avoid locking unrelated work.
  select request.* into locked_request from public.repair_requests request
  where request.id=p_request_id and exists (
    select 1 from public.repair_offers offer
    where offer.id=request.accepted_offer_id and offer.request_id=request.id
      and offer.status='accepted' and offer.workshop_user_id=workshop_id)
  for update of request;
  if not found then
    raise exception 'Work progress is not available' using errcode='42501';
  end if;
  select offer.* into locked_offer from public.repair_offers offer
  where offer.id=locked_request.accepted_offer_id and offer.request_id=locked_request.id
    and offer.status='accepted' and offer.workshop_user_id=workshop_id
  for update of offer;
  if not found then
    raise exception 'Work progress is not available' using errcode='42501';
  end if;
  -- No new sequential-stage or completed-workflow policy. Closed requests stay closed.
  if locked_request.status is null or locked_request.status not in ('matched','in_progress','completed') then
    raise exception 'Request status does not allow work progress' using errcode='42501';
  end if;

  category := case when locked_request.service_type is null
    or pg_catalog.btrim(locked_request.service_type)='' then 'bodywork'
    else locked_request.service_type end;
  allowed_stages := case category
    when 'bodywork' then array['Received','Disassembly','Body repair','Paint preparation','Painting','Polishing','Ready']
    when 'mechanical' then array['Received','Diagnosis','Parts ordered','In repair','Testing','Ready']
    when 'wheels' then array['Received','Inspection','Wheel / Tire service','Final check','Ready']
    when 'towing' then array['Received','Dispatch','Vehicle picked up','In transit','Ready']
    else null end;
  if stage is null or allowed_stages is null or not (stage=any(allowed_stages)) then
    raise exception 'Invalid progress stage for request category' using errcode='22023';
  end if;
  if p_message is null or p_images is null
    or pg_catalog.jsonb_typeof(p_images) is distinct from 'array' then
    raise exception 'Invalid progress message or images' using errcode='22023';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_images) image(value)
    where pg_catalog.jsonb_typeof(image.value) is distinct from 'string'
      or pg_catalog.btrim(image.value #>> '{}')='') then
    raise exception 'Invalid progress image reference' using errcode='22023';
  end if;

  -- Preserve message and image references verbatim. No upload/delete/URL rewriting.
  progress_values.status := stage;
  insert into public.work_progress_updates as progress
    (request_id, sender_id, sender_role, status, message, images)
  values (locked_request.id, workshop_id, 'workshop', progress_values.status, p_message, p_images)
  returning progress.id into saved_progress_id;
  if not found or saved_progress_id is null then
    raise exception 'Progress was not inserted' using errcode='P0001';
  end if;

  next_status := case when stage='Ready' then 'completed' else 'in_progress' end;
  update public.repair_requests as request set status=next_status
  where request.id=locked_request.id
  returning request.* into saved_request;
  if not found or saved_request.id is distinct from locked_request.id
    or saved_request.status is distinct from next_status then
    raise exception 'Request status was not persisted' using errcode='P0001';
  end if;
  -- Any validation, trigger, constraint or UPDATE error rolls back the INSERT too.
  -- No exception swallowing, compensating writes or separate status request.
  return query select saved_request.id, saved_request.status::text;
end;
$function$;

alter function public.save_work_progress_update(uuid,text,text,jsonb) owner to postgres;
revoke all on function public.save_work_progress_update(uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_work_progress_update(uuid,text,text,jsonb) to authenticated;

do $security$
declare
  function_id oid := 'public.save_work_progress_update(uuid,text,text,jsonb)'::pg_catalog.regprocedure;
begin
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid=function_id
    and p.proowner='postgres'::pg_catalog.regrole and p.prosecdef and p.provolatile='v'
    and p.proconfig=array['search_path=""']::text[]
    and pg_catalog.pg_get_function_result(p.oid)='TABLE(id uuid, status text)')
    or not pg_catalog.has_function_privilege('authenticated',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',function_id,'EXECUTE')
    or exists (select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=function_id and (a.grantee not in
        ('postgres'::pg_catalog.regrole::oid,'authenticated'::pg_catalog.regrole::oid)
        or (a.grantee='authenticated'::pg_catalog.regrole::oid and a.is_grantable))) then
    raise exception 'BLOCKED_PROGRESS_RPC_SECURITY';
  end if;
end;
$security$;
commit;
