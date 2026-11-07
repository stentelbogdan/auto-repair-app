-- LOCAL PREPARATION ONLY. TEST bstjobvvxxfqqwyjoimx / 7692131729119822239.
-- Reads only the latest history stage needed by Clock. Does not replace the writer,
-- grant direct table access, modify RLS, or touch notifications/Realtime/Storage.
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
    where n.nspname='public' and p.proname='get_workshop_latest_work_progress') then
    raise exception 'BLOCKED_PROGRESS_READER_ALREADY_EXISTS';
  end if;
  if pg_catalog.to_regprocedure('auth.uid()') is null
    or pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regclass('public.repair_requests') is null
    or pg_catalog.to_regclass('public.repair_offers') is null
    or (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid=pg_catalog.to_regclass('public.work_progress_updates')
        and a.attname in ('id','request_id','status','created_at') and not a.attisdropped) <> 4 then
    raise exception 'BLOCKED_PROGRESS_READER_DEPENDENCIES';
  end if;
end;
$preflight$;

create function public.get_workshop_latest_work_progress(p_request_id uuid)
returns table(request_id uuid, status text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workshop_id uuid := auth.uid();
begin
  -- STABLE: authorization and history use the same statement snapshot. No row locks.
  -- Absent and inaccessible requests share the same error; [] means authorized but empty.
  if v_workshop_id is null or not exists (
    select 1 from public.repair_requests request
    join public.repair_offers offer on offer.id=request.accepted_offer_id
      and offer.request_id=request.id and offer.status='accepted'
    join public.profiles profile on profile.id=offer.workshop_user_id
    where request.id=p_request_id and offer.workshop_user_id=v_workshop_id
      and coalesce(pg_catalog.to_jsonb(profile.role),'[]'::jsonb) @> '["workshop"]'::jsonb
  ) then
    raise exception 'Work progress is not available' using errcode='42501';
  end if;

  return query
    select progress.request_id, progress.status::text
    from public.work_progress_updates progress
    where progress.request_id=p_request_id
    order by progress.created_at desc, progress.id desc
    limit 1;
end;
$function$;

alter function public.get_workshop_latest_work_progress(uuid) owner to postgres;
revoke all on function public.get_workshop_latest_work_progress(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_workshop_latest_work_progress(uuid) to authenticated;

do $security$
declare
  function_id oid := 'public.get_workshop_latest_work_progress(uuid)'::pg_catalog.regprocedure;
begin
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid=function_id
    and p.proowner='postgres'::pg_catalog.regrole and p.prosecdef and p.provolatile='s'
    and p.proconfig=array['search_path=""']::text[]
    and pg_catalog.pg_get_function_result(p.oid)='TABLE(request_id uuid, status text)')
    or not pg_catalog.has_function_privilege('authenticated',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',function_id,'EXECUTE')
    or exists (select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=function_id and (a.grantee not in
        ('postgres'::pg_catalog.regrole::oid,'authenticated'::pg_catalog.regrole::oid)
        or (a.grantee='authenticated'::pg_catalog.regrole::oid and a.is_grantable))) then
    raise exception 'BLOCKED_PROGRESS_READER_SECURITY';
  end if;
end;
$security$;
commit;
