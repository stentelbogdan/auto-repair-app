-- Local review only; no installation authorized by this file's preparation.
-- TEST bstjobvvxxfqqwyjoimx / 7692131729119822239.
-- Separate gallery reader. Existing Clock/save RPCs, RLS and photo contracts are unchanged.
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
    where n.nspname='public' and p.proname='get_workshop_work_progress_history') then
    raise exception 'BLOCKED_PROGRESS_HISTORY_ALREADY_EXISTS';
  end if;
  if pg_catalog.to_regprocedure('auth.uid()') is null
    or pg_catalog.to_regclass('public.profiles') is null
    or pg_catalog.to_regclass('public.repair_requests') is null
    or pg_catalog.to_regclass('public.repair_offers') is null
    or (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid=pg_catalog.to_regclass('public.work_progress_updates')
        and not a.attisdropped and a.attnum > 0
        and ((a.attname in ('id','request_id') and a.atttypid='uuid'::pg_catalog.regtype)
          or (a.attname='images' and a.atttypid='jsonb'::pg_catalog.regtype)
          or (a.attname='created_at' and a.atttypid='timestamptz'::pg_catalog.regtype)
          or a.attname in ('status','message'))) <> 6 then
    raise exception 'BLOCKED_PROGRESS_HISTORY_DEPENDENCIES';
  end if;
end;
$preflight$;

create function public.get_workshop_work_progress_history(p_request_id uuid)
returns table(id uuid, request_id uuid, status text, message text, images jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workshop_id uuid := auth.uid();
begin
  -- Authorization and history share the STABLE statement snapshot. No row locks.
  if v_workshop_id is null or not exists (
    select 1 from public.repair_requests request
    join public.repair_offers offer on offer.id=request.accepted_offer_id
      and offer.request_id=request.id and offer.status='accepted'
    join public.profiles profile on profile.id=offer.workshop_user_id
    where request.id=p_request_id and offer.workshop_user_id=v_workshop_id
      and coalesce(pg_catalog.to_jsonb(profile.role),'[]'::jsonb) @> '["workshop"]'::jsonb
  ) then
    -- Same error for absent and inaccessible work; zero rows means authorized empty history.
    raise exception 'Work progress history is not available' using errcode='42501';
  end if;

  return query
    select progress.id, progress.request_id, progress.status::text,
      progress.message::text, progress.images, progress.created_at
    from public.work_progress_updates progress
    where progress.request_id=p_request_id
    order by progress.created_at desc, progress.id desc;
end;
$function$;

alter function public.get_workshop_work_progress_history(uuid) owner to postgres;
revoke all on function public.get_workshop_work_progress_history(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_workshop_work_progress_history(uuid) to authenticated;

do $security$
declare
  function_id oid := 'public.get_workshop_work_progress_history(uuid)'::pg_catalog.regprocedure;
begin
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid=function_id
    and p.proowner='postgres'::pg_catalog.regrole and p.prosecdef and p.provolatile='s'
    and p.proconfig=array['search_path=""']::text[]
    and pg_catalog.pg_get_function_result(p.oid)=
      'TABLE(id uuid, request_id uuid, status text, message text, images jsonb, created_at timestamp with time zone)')
    or not pg_catalog.has_function_privilege('authenticated',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',function_id,'EXECUTE')
    or exists (select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=function_id and (a.grantee not in
        ('postgres'::pg_catalog.regrole::oid,'authenticated'::pg_catalog.regrole::oid)
        or (a.grantee='authenticated'::pg_catalog.regrole::oid and a.is_grantable))) then
    raise exception 'BLOCKED_PROGRESS_HISTORY_SECURITY';
  end if;
end;
$security$;
commit;
