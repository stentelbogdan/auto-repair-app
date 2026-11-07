-- LOCAL REVIEW ONLY: fixes the query-169 work-progress upload authorizer, not the save RPC.
-- No Storage operations, data backfill, policy changes or new permissions.
-- Expected TEST project: bstjobvvxxfqqwyjoimx; source evidence query-169.
-- Stop on any error/drift. Do not retry after an uncertain COMMIT.
begin transaction read write;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $repair$
declare
  function_id oid;
  metadata_before jsonb;
  metadata_after jsonb;
  body_before text;
  body_after text;
begin
  if current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres' or session_user is distinct from 'postgres'
    or (select control.system_identifier::text from pg_catalog.pg_control_system() control)
      is distinct from '7692131729119822239' then
    raise exception 'BLOCKED_TEST_IDENTITY';
  end if;
  function_id := pg_catalog.to_regprocedure('public.storage_work_progress_image_authorized(text,boolean)');
  select pg_catalog.to_jsonb(p)-'prosrc', p.prosrc
    into metadata_before, body_before from pg_catalog.pg_proc p where p.oid=function_id;
  if function_id is null or pg_catalog.md5(body_before) is distinct from 'f7ecb46053eb2973852e8e92b9dd48ac'
    or not exists (select 1 from pg_catalog.pg_proc p where p.oid=function_id
      and p.proowner='postgres'::pg_catalog.regrole and p.prosecdef and p.provolatile='s'
      and p.proconfig=array['search_path=""']::text[] and p.prorettype='boolean'::pg_catalog.regtype)
    or not pg_catalog.has_function_privilege('authenticated',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',function_id,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',function_id,'EXECUTE') then
    raise exception 'BLOCKED_UPLOAD_AUTHORIZER_CONTRACT_DRIFT';
  end if;

  -- Only disambiguate local variables inside the existing SELECT. CREATE OR REPLACE
  -- keeps the function OID, dependency links, owner and ACL; verify all metadata below.
  execute $definition$
CREATE OR REPLACE FUNCTION public.storage_work_progress_image_authorized(p_name text, p_require_workshop boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<object_authority>>
DECLARE parts text[] := pg_catalog.string_to_array(p_name, '/'); request_id uuid; workshop_id uuid; current_user_id uuid := auth.uid();
BEGIN
 IF current_user_id IS NULL OR pg_catalog.array_length(parts,1)<>3 THEN RETURN false; END IF;
 request_id:=parts[1]::uuid; workshop_id:=parts[2]::uuid;
 IF p_require_workshop AND workshop_id<>current_user_id THEN RETURN false; END IF;
 RETURN EXISTS (SELECT 1 FROM public.repair_requests request JOIN public.repair_offers offer ON offer.id=request.accepted_offer_id AND offer.request_id=request.id AND offer.workshop_user_id=object_authority.workshop_id AND offer.status='accepted' WHERE request.id=object_authority.request_id AND (object_authority.current_user_id=request.user_id OR object_authority.current_user_id=object_authority.workshop_id));
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;$function$;
$definition$;

  select pg_catalog.to_jsonb(p)-'prosrc', p.prosrc
    into metadata_after, body_after from pg_catalog.pg_proc p where p.oid=function_id;
  if metadata_after is distinct from metadata_before
    or pg_catalog.md5(body_after) is distinct from 'f073c00a8eea6a822622ad92331098eb' then
    raise exception 'BLOCKED_UPLOAD_AUTHORIZER_POSTCHECK';
  end if;
end;
$repair$;
commit;
