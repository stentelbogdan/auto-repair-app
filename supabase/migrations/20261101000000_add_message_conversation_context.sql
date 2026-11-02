-- Prepared locally only. TEST bstjobvvxxfqqwyjoimx; installation requires separate review.
-- Adds one read-only RPC. Does not replace any existing function, policy or table.
begin transaction read write;

do $preflight$
begin
  if current_database() <> 'postgres' or current_user <> 'postgres' or session_user <> 'postgres'
    or (select system_identifier::text from pg_catalog.pg_control_system())
      is distinct from '7692131729119822239' then
    raise exception 'BLOCKED_TEST_IDENTITY';
  end if;
  if pg_catalog.current_setting('transaction_read_only') <> 'off' then
    raise exception 'BLOCKED_INSTALLER_REQUIRES_READ_WRITE';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_message_conversation_context'
  ) then
    raise exception 'BLOCKED_CONTEXT_NAME_ALREADY_EXISTS';
  end if;
  -- Freeze the reviewed local participant contract; drift requires review, never replacement.
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('public.is_message_conversation_participant(uuid,uuid)')
      and p.prorettype='boolean'::pg_catalog.regtype and not p.proretset
      and p.prosecdef and p.provolatile='s' and not p.proisstrict
      and p.proowner='postgres'::pg_catalog.regrole
      and p.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
      and p.proconfig=array['search_path=""']::text[]
      and pg_catalog.md5(p.prosrc)='48a3c8a1b05364deac87fe37f6664881'
  ) or pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception 'BLOCKED_PARTICIPANT_CONTRACT_REVIEW_REQUIRED';
  end if;
end;
$preflight$;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- BEGIN CONTEXT FUNCTION
create function public.get_message_conversation_context(
  p_request_id uuid,
  p_offer_id uuid
)
returns table (request_data jsonb)
language sql
stable
security definer
called on null input
set search_path = ''
as $context$
  select pg_catalog.jsonb_build_object(
    'request_id', request.id,
    'offer_id', p_offer_id,
    'car_brand', request.car_brand,
    'car_model', request.car_model,
    'city', request.city,
    'status', request.status,
    'images', request.images,
    'request_type', request.request_type,
    'target_workshop_id', request.target_workshop_id
  )
  from public.repair_requests as request
  where request.id = p_request_id
    and auth.uid() is not null
    and public.is_message_conversation_participant(request.id, p_offer_id) is true;
$context$;
-- END CONTEXT FUNCTION
alter function public.get_message_conversation_context(uuid, uuid) owner to postgres;
revoke all on function public.get_message_conversation_context(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_message_conversation_context(uuid, uuid) to authenticated;

do $security$
declare
  v_function oid := 'public.get_message_conversation_context(uuid,uuid)'::pg_catalog.regprocedure;
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid=v_function and p.proowner='postgres'::pg_catalog.regrole
      and p.prosecdef and p.provolatile='s' and not p.proisstrict and p.proretset
      and p.prorettype='jsonb'::pg_catalog.regtype
      and p.proconfig=array['search_path=""']::text[]
      and p.prolang=(select oid from pg_catalog.pg_language where lanname='sql')
  ) or not pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',v_function,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',v_function,'EXECUTE')
    or exists (
      select 1 from pg_catalog.pg_proc p,
        lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=v_function and (a.grantee not in
        ('postgres'::pg_catalog.regrole::oid,'authenticated'::pg_catalog.regrole::oid)
        or (a.grantee='authenticated'::pg_catalog.regrole::oid and a.is_grantable))
    ) then
    raise exception 'BLOCKED_CONTEXT_SECURITY';
  end if;
end;
$security$;
commit;
