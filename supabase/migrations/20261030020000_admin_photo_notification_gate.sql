-- 4G local candidate. Prepare/confirm proof and atomic quotas, NOT business RPCs.
-- No frontend grants on the private schema. No photo triggers or Storage writes.
begin;
do $identity$
begin
 if current_database() <> 'postgres' or current_user <> 'postgres' or session_user <> 'postgres'
   or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7692131729119822239' then
   raise exception 'BLOCKED_TEST_IDENTITY';
 end if;
 if not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls)
   or pg_catalog.to_regprocedure('auth.role()') is null then
   raise exception 'BLOCKED_PRIVILEGE_CONTRACT';
 end if;
 if current_setting('app.admin_photo_contract_review',true) is distinct from '4g-v1' then
   raise exception 'BLOCKED_CONTRACT_REVIEW_REQUIRED';
 end if;
end;
$identity$;
create schema admin_photo_private authorization postgres;
revoke all on schema admin_photo_private from public,anon,authenticated,service_role;
create table admin_photo_private.budget (
 actor uuid primary key, window_start timestamptz not null, prepared integer not null check(prepared between 0 and 30),
 call_window timestamptz not null, calls integer not null check(calls between 0 and 120)
);
create table admin_photo_private.tickets (
 ticket uuid primary key default pg_catalog.gen_random_uuid(), actor uuid not null,
 kind text not null check(kind in ('upload','request_images')), object_path text,
 request_id uuid, baseline text, issued_at timestamptz not null,
 expires_at timestamptz not null, consumed boolean not null default false
);
create table admin_photo_private.claimed_events (
 actor uuid not null, evidence text not null, expires_at timestamptz not null, primary key(actor,evidence)
);
create index tickets_actor_expiry on admin_photo_private.tickets(actor,expires_at);
alter table admin_photo_private.claimed_events enable row level security;
alter table admin_photo_private.claimed_events force row level security;
alter table admin_photo_private.budget enable row level security;
alter table admin_photo_private.budget force row level security;
alter table admin_photo_private.tickets enable row level security;
alter table admin_photo_private.tickets force row level security;
revoke all on all tables in schema admin_photo_private from public,anon,authenticated,service_role;

create function public.admin_photo_notification_gate(
 p_actor uuid, p_action text, p_kind text, p_object_name text, p_request_id uuid, p_ticket uuid
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $gate$
declare
 stamp timestamptz := pg_catalog.clock_timestamp();
 q admin_photo_private.budget%rowtype;
 t admin_photo_private.tickets%rowtype;
 path text; before_hash text; next_hash text; new_ticket uuid; v_evidence text;
 eligible boolean := false;
begin
 if auth.role() is distinct from 'service_role' or p_actor is null then
   raise exception using errcode='42501',message='NOT_AUTHORIZED';
 end if;
 if p_action not in ('prepare','confirm') or p_action is null then
   return '{"version":"4g-v1","status":"ineligible"}'::jsonb;
 end if;
 -- All requests acquire ONLY notification locks, in budget -> ticket order.
 insert into admin_photo_private.budget values(p_actor,stamp,0,stamp,0) on conflict(actor) do nothing;
 select * into q from admin_photo_private.budget where actor=p_actor for update;
 if q.call_window+interval '1 minute'<=stamp then
   update admin_photo_private.budget set call_window=stamp,calls=0 where actor=p_actor;
   q.calls:=0;
 end if;
 if q.calls>=120 then return '{"version":"4g-v1","status":"throttled"}'::jsonb; end if;
 update admin_photo_private.budget set calls=calls+1 where actor=p_actor;
 delete from admin_photo_private.claimed_events where actor=p_actor and expires_at<=stamp;
 -- Lazy per-user expiry cleanup, no global task, never touches application rows.
 delete from admin_photo_private.tickets where actor=p_actor and expires_at<=stamp;
 if p_action='prepare' then
   if p_ticket is not null then return '{"version":"4g-v1","status":"ineligible"}'::jsonb; end if;
   if q.window_start+interval '1 hour'<=stamp then
     update admin_photo_private.budget set window_start=stamp,prepared=0 where actor=p_actor;
     q.prepared:=0;
   end if;
   if q.prepared>=30 then return '{"version":"4g-v1","status":"throttled"}'::jsonb; end if;
   if p_kind='upload' and p_request_id is null and p_object_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' then
     path:=p_actor::text||'/'||p_object_name;
     select exists(select 1 from repair_image_private.repair_image_objects o
       where o.bucket_id='repair-images' and o.object_path=path and o.owner_user_id=p_actor
       and o.lifecycle_state='reserved' and o.uploaded_at is null
       and o.upload_lease_expires_at>stamp) into eligible;
   elsif p_kind='request_images' and p_object_name is null then
     if p_request_id is null then eligible:=true; -- Must prove NEW request after ticket issuance at confirm.
     else
       select pg_catalog.md5(coalesce(r.images::text,'SQL_NULL')) into before_hash
         from public.repair_requests r where r.id=p_request_id and r.user_id=p_actor;
       eligible:=found;
     end if;
   end if;
   if not eligible then return '{"version":"4g-v1","status":"ineligible"}'::jsonb; end if;
   insert into admin_photo_private.tickets(actor,kind,object_path,request_id,baseline,issued_at,expires_at)
     values(p_actor,p_kind,path,p_request_id,before_hash,stamp,stamp+interval '15 minutes') returning ticket into new_ticket;
   update admin_photo_private.budget set prepared=prepared+1 where actor=p_actor;
   return pg_catalog.jsonb_build_object('version','4g-v1','status','prepared','ticket',new_ticket);
 end if;
 if p_ticket is null or p_kind is not null or p_object_name is not null then
   return '{"version":"4g-v1","status":"ineligible"}'::jsonb;
 end if;
 select * into t from admin_photo_private.tickets where ticket=p_ticket and actor=p_actor for update;
 if not found or t.expires_at<=stamp then return '{"version":"4g-v1","status":"ineligible"}'::jsonb; end if;
 if t.consumed then return '{"version":"4g-v1","status":"suppressed"}'::jsonb; end if;
 if t.kind='upload' and p_request_id is null then
   select pg_catalog.md5('upload|'||o.object_path||'|'||o.uploaded_at::text) into v_evidence
     from repair_image_private.repair_image_objects o
     join storage.objects s on s.bucket_id=o.bucket_id and s.name=o.object_path
     where o.bucket_id='repair-images' and o.object_path=t.object_path and o.owner_user_id=p_actor
       and o.lifecycle_state in ('uploaded','attached') and o.uploaded_at>=t.issued_at
       -- A versioned object is eligible only through its current metadata row.
       -- is_versioned may be true or false; archived_at defines currentness.
       and s.archived_at is null
       and s.owner_id=p_actor::text;
   eligible:=found;
 elsif t.kind='request_images' then
   if t.request_id is null and p_request_id is not null then
     select pg_catalog.md5('request|'||r.id::text||'|'||r.xmin::text) into v_evidence
       from public.repair_requests r where r.id=p_request_id and r.user_id=p_actor
       and r.created_at>=t.issued_at and r.images is not null and r.images not in ('null'::jsonb,'[]'::jsonb);
     eligible:=found;
   elsif t.request_id is not null and (p_request_id is null or p_request_id=t.request_id) then
     select pg_catalog.md5(coalesce(r.images::text,'SQL_NULL')),
         pg_catalog.md5('request|'||r.id::text||'|'||r.xmin::text) into next_hash,v_evidence
       from public.repair_requests r where r.id=t.request_id and r.user_id=p_actor;
     eligible:=found and next_hash is distinct from t.baseline;
   end if;
 end if;
 if not eligible then return '{"version":"4g-v1","status":"ineligible"}'::jsonb; end if;
 insert into admin_photo_private.claimed_events values(p_actor,v_evidence,stamp+interval '15 minutes')
   on conflict(actor,evidence) do nothing;
 if not found then
   update admin_photo_private.tickets set consumed=true where ticket=t.ticket;
   return '{"version":"4g-v1","status":"suppressed"}'::jsonb;
 end if;
 -- Consume before attempting HTTP; repeated confirms NEVER retry a lost emit.
 update admin_photo_private.tickets set consumed=true where ticket=t.ticket and not consumed;
 if not found then return '{"version":"4g-v1","status":"suppressed"}'::jsonb; end if;
 return '{"version":"4g-v1","status":"claimed"}'::jsonb;
end;
$gate$;
alter function public.admin_photo_notification_gate(uuid,text,text,text,uuid,uuid) owner to postgres;
revoke all on function public.admin_photo_notification_gate(uuid,text,text,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_photo_notification_gate(uuid,text,text,text,uuid,uuid) to service_role;
commit;
