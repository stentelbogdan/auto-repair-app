-- Local candidate only. Separate physical-completion evidence; existing gates/RPCs unchanged.
-- TEST bstjobvvxxfqqwyjoimx. Review and installation are separate operator actions.
begin;
do $identity$
begin
 if current_database() <> 'postgres' or current_user <> 'postgres' or session_user <> 'postgres'
   or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7692131729119822239' then
   raise exception 'BLOCKED_TEST_IDENTITY';
 end if;
 if current_setting('app.admin_photo_deletion_contract_review',true) is distinct from 'deletion-v1' then
   raise exception 'BLOCKED_CONTRACT_REVIEW_REQUIRED';
 end if;
 if not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls)
   or pg_catalog.to_regprocedure('public.admin_photo_notification_gate(uuid,text,text,text,uuid,uuid)') is null
   or pg_catalog.to_regclass('admin_photo_private.budget') is null
   or pg_catalog.to_regclass('admin_photo_private.claimed_events') is null
   or pg_catalog.to_regclass('repair_image_private.targeted_image_detachments') is null
   or pg_catalog.to_regclass('repair_image_private.repair_image_objects') is null then
   raise exception 'BLOCKED_DEPENDENCY_CONTRACT';
 end if;
 if pg_catalog.to_regclass('admin_photo_private.deletion_tickets') is not null
   or pg_catalog.to_regprocedure('public.admin_photo_deletion_notification_gate(uuid,text,uuid,uuid,uuid)') is not null then
   raise exception 'BLOCKED_OBJECT_ALREADY_EXISTS';
 end if;
end;
$identity$;

create table admin_photo_private.deletion_tickets (
 ticket uuid primary key default pg_catalog.gen_random_uuid(), actor uuid not null,
 request_id uuid not null, operation_id uuid not null,
 issued_at timestamptz not null, expires_at timestamptz not null,
 consumed boolean not null default false,
 check(expires_at > issued_at)
);
alter table admin_photo_private.deletion_tickets owner to postgres;
create index deletion_tickets_actor_expiry on admin_photo_private.deletion_tickets(actor,expires_at);
alter table admin_photo_private.deletion_tickets enable row level security;
alter table admin_photo_private.deletion_tickets force row level security;
revoke all on admin_photo_private.deletion_tickets from public,anon,authenticated,service_role;

create function public.admin_photo_deletion_notification_gate(
 p_actor uuid, p_action text, p_request_id uuid, p_operation_id uuid, p_ticket uuid
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $gate$
declare
 stamp timestamptz := pg_catalog.clock_timestamp();
 q admin_photo_private.budget%rowtype;
 t admin_photo_private.deletion_tickets%rowtype;
 new_ticket uuid;
 v_evidence text;
begin
 if auth.role() is distinct from 'service_role' or p_actor is null then
   raise exception using errcode='42501',message='NOT_AUTHORIZED';
 end if;
 if p_action is null or p_action not in ('prepare','confirm') or p_request_id is null or p_operation_id is null then
   return '{"version":"deletion-v1","status":"ineligible"}'::jsonb;
 end if;
 -- Shared quotas with upload/association; identical budget -> ticket -> evidence order.
 -- Never lock a business row, never call a business RPC or send a notification here.
 insert into admin_photo_private.budget values(p_actor,stamp,0,stamp,0) on conflict(actor) do nothing;
 select * into q from admin_photo_private.budget where actor=p_actor for update;
 stamp := pg_catalog.clock_timestamp(); -- Issuance/expiry cannot precede a budget-lock wait.
 if q.call_window+interval '1 minute'<=stamp then
   update admin_photo_private.budget set call_window=stamp,calls=0 where actor=p_actor;
   q.calls:=0;
 end if;
 if q.calls>=120 then return '{"version":"deletion-v1","status":"throttled"}'::jsonb; end if;
 update admin_photo_private.budget set calls=calls+1 where actor=p_actor;
 delete from admin_photo_private.claimed_events where actor=p_actor and expires_at<=stamp;
 delete from admin_photo_private.deletion_tickets where actor=p_actor and expires_at<=stamp;
 if p_action='prepare' then
   if p_ticket is not null then return '{"version":"deletion-v1","status":"ineligible"}'::jsonb; end if;
   if q.window_start+interval '1 hour'<=stamp then
     update admin_photo_private.budget set window_start=stamp,prepared=0 where actor=p_actor;
     q.prepared:=0;
   end if;
   if q.prepared>=30 then return '{"version":"deletion-v1","status":"throttled"}'::jsonb; end if;
   -- A new detachment receipt need not exist yet. UUIDs are bound selectors, NOT proof.
   if not exists(select 1 from public.repair_requests r where r.id=p_request_id and r.user_id=p_actor)
     or exists(select 1 from repair_image_private.targeted_image_detachments d
       where d.operation_id=p_operation_id and (d.owner_user_id is distinct from p_actor
         or d.request_id is distinct from p_request_id or d.deletion_authorized is not true)) then
     return '{"version":"deletion-v1","status":"ineligible"}'::jsonb;
   end if;
   insert into admin_photo_private.deletion_tickets(actor,request_id,operation_id,issued_at,expires_at)
     values(p_actor,p_request_id,p_operation_id,stamp,stamp+interval '15 minutes') returning ticket into new_ticket;
   update admin_photo_private.budget set prepared=prepared+1 where actor=p_actor;
   return pg_catalog.jsonb_build_object('version','deletion-v1','status','prepared','ticket',new_ticket);
 end if;
 if p_ticket is null then return '{"version":"deletion-v1","status":"ineligible"}'::jsonb; end if;
 select * into t from admin_photo_private.deletion_tickets where ticket=p_ticket and actor=p_actor for update;
 if not found or t.expires_at<=stamp or t.request_id is distinct from p_request_id
   or t.operation_id is distinct from p_operation_id then
   return '{"version":"deletion-v1","status":"ineligible"}'::jsonb;
 end if;
 if t.consumed then return '{"version":"deletion-v1","status":"suppressed"}'::jsonb; end if;
 -- Deleted rows are immutable under the existing registry guard. No request.xmin dependency.
 -- Canonical JSON + epoch avoids delimiter/hash collisions and session timezone differences.
 -- Evidence remains private; the response contains ONLY version/status (and ticket at prepare).
 select 'physical-deletion-v1:' || pg_catalog.jsonb_build_array(
     o.bucket_id,o.object_path,extract(epoch from o.deleted_at),o.row_version)::text into v_evidence
   from repair_image_private.targeted_image_detachments d
   join repair_image_private.repair_image_objects o
     on o.bucket_id=d.bucket_id and o.object_path=d.object_path
   where d.operation_id=t.operation_id and d.request_id=t.request_id and d.owner_user_id=p_actor
     and d.deletion_authorized is true and d.bucket_id='repair-images'
     and o.owner_user_id=p_actor and o.lifecycle_state='deleted'
     and o.deleted_at is not null and pg_catalog.isfinite(o.deleted_at)
     and o.deleted_at>t.issued_at and o.deleted_at<=stamp and o.row_version>0;
 if not found then return '{"version":"deletion-v1","status":"ineligible"}'::jsonb; end if;
 insert into admin_photo_private.claimed_events values(p_actor,v_evidence,stamp+interval '15 minutes')
   on conflict(actor,evidence) do nothing;
 if not found then
   update admin_photo_private.deletion_tickets set consumed=true where ticket=t.ticket;
   return '{"version":"deletion-v1","status":"suppressed"}'::jsonb;
 end if;
 -- Consume atomically BEFORE best-effort HTTP. Lost sends are never retried.
 update admin_photo_private.deletion_tickets set consumed=true where ticket=t.ticket and not consumed;
 if not found then return '{"version":"deletion-v1","status":"suppressed"}'::jsonb; end if;
 return '{"version":"deletion-v1","status":"claimed"}'::jsonb;
end;
$gate$;
alter function public.admin_photo_deletion_notification_gate(uuid,text,uuid,uuid,uuid) owner to postgres;
revoke all on function public.admin_photo_deletion_notification_gate(uuid,text,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_photo_deletion_notification_gate(uuid,text,uuid,uuid,uuid) to service_role;
-- Verify new object security before the only COMMIT, including inherited default ACLs.
do $security$
begin
 if not exists(select 1 from pg_catalog.pg_class c
   where c.oid='admin_photo_private.deletion_tickets'::regclass and c.relkind='r'
     and c.relowner='postgres'::regrole and c.relrowsecurity and c.relforcerowsecurity)
   or exists(select 1 from pg_catalog.pg_class c,
     lateral pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
     where c.oid='admin_photo_private.deletion_tickets'::regclass and a.grantee<>c.relowner) then
   raise exception 'BLOCKED_TICKET_SECURITY';
 end if;
 if not exists(select 1 from pg_catalog.pg_proc p
   where p.oid='public.admin_photo_deletion_notification_gate(uuid,text,uuid,uuid,uuid)'::regprocedure
     and p.proowner='postgres'::regrole and p.prosecdef and p.prorettype='jsonb'::regtype
     and 'search_path=""'=any(p.proconfig) and 'lock_timeout=1s'=any(p.proconfig))
   or exists(select 1 from pg_catalog.pg_proc p,
     lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
     where p.oid='public.admin_photo_deletion_notification_gate(uuid,text,uuid,uuid,uuid)'::regprocedure
       and a.grantee not in (p.proowner,'service_role'::regrole))
   or not pg_catalog.has_function_privilege('service_role',
     'public.admin_photo_deletion_notification_gate(uuid,text,uuid,uuid,uuid)','EXECUTE') then
   raise exception 'BLOCKED_GATE_SECURITY';
 end if;
end;
$security$;
commit;
