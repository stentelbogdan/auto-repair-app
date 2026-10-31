-- TEST-only 4X candidate. PREPARED, NOT EXECUTED. Permanent form ends with COMMIT.
-- ONLY two persistent ALTER POLICY statements. All helper tables/policies are TEMP.
-- Source: official Realtime authorization probe omits private; row DEFAULT false
-- is independent of the connection's config.private=true. No runtime proof claimed.
-- https://github.com/supabase/realtime/blob/master/lib/realtime/tenants/authorization.ex
-- https://supabase.com/docs/guides/realtime/concepts
begin;
do $identity$
begin
 if current_database() is distinct from 'postgres' or current_user is distinct from 'postgres'
    or session_user is distinct from 'postgres'
    or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7692131729119822239' then
   raise exception 'BLOCKED_TEST_IDENTITY';
 end if;
end;
$identity$;
set local search_path=pg_catalog,public;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local idle_in_transaction_session_timeout='60s';
do $operator$
declare
 security_reviewed boolean := false;
 endpoint_and_emitter_disabled_verified boolean := false;
 exclusive_ddl_window_confirmed boolean := false;
begin
 if not security_reviewed or not endpoint_and_emitter_disabled_verified or not exclusive_ddl_window_confirmed then
   raise exception 'BLOCKED_OPERATOR_CONFIRMATIONS_REQUIRED';
 end if;
 if exists(select 1 from pg_catalog.pg_class where relnamespace=pg_catalog.pg_my_temp_schema() and left(relname,6)='ap4x__') then
   raise exception 'BLOCKED_TEMP_COLLISION';
 end if;
end;
$operator$;
do $reviewed_hooks$
begin
 if current_setting('session_replication_role') is distinct from 'origin' then
   raise exception 'BLOCKED_REPLICATION_MODE_CHANGED';
 end if;
 if (select count(*) from pg_catalog.pg_event_trigger where evtenabled<>'D')<>6 then
   raise exception 'BLOCKED_EVENT_TRIGGER_INVENTORY_CHANGED';
 end if;
 if exists(
  with expected(name,event,mode,ns,fn,owner,definition_md5,unrestricted) as (values
   ('issue_pg_cron_access','ddl_command_end','O','extensions','grant_pg_cron_access','supabase_admin','53a44336da0ac1dd62d89dbd988e6d1d',false),
   ('issue_pg_graphql_access','ddl_command_end','O','extensions','grant_pg_graphql_access','supabase_admin','4e6d7efe4aed1b3b92063b648aa7a0cf',false),
   ('issue_pg_net_access','ddl_command_end','O','extensions','grant_pg_net_access','supabase_admin','1d06ef4fb47bb0ab6e6f8818a62013bb',false),
   ('pgrst_ddl_watch','ddl_command_end','O','extensions','pgrst_ddl_watch','supabase_admin','afaad7193dcf8f81e728d2bedb85e43e',true),
   ('issue_graphql_placeholder','sql_drop','O','extensions','set_graphql_placeholder','supabase_admin','8da9dff6b2ae47498209d341acaeb60b',false),
   ('pgrst_drop_watch','sql_drop','O','extensions','pgrst_drop_watch','supabase_admin','4357772baf5cfcd5c6d7049585b3a537',true)
  )
  select 1 from expected x
  left join pg_catalog.pg_event_trigger e on e.evtname=x.name
  left join pg_catalog.pg_proc p on p.oid=e.evtfoid
  left join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where e.oid is null or e.evtevent is distinct from x.event
    or e.evtenabled::text is distinct from x.mode
    or n.nspname is distinct from x.ns or p.proname is distinct from x.fn
    or p.pronargs is distinct from 0
    or p.prorettype is distinct from 'event_trigger'::regtype
    or pg_catalog.pg_get_userbyid(e.evtowner) is distinct from x.owner
    or pg_catalog.pg_get_userbyid(p.proowner) is distinct from x.owner
    or pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) is distinct from x.definition_md5
    or (e.evttags is null) is distinct from x.unrestricted
    or (not x.unrestricted and e.evttags && array['ALTER POLICY','CREATE POLICY','CREATE SCHEMA','CREATE TABLE','CREATE INDEX','ALTER TABLE','CREATE FUNCTION','ALTER FUNCTION','GRANT','REVOKE','CREATE TABLE AS','DROP TABLE']::text[])
 ) then
   raise exception 'BLOCKED_EVENT_TRIGGER_CONTRACT_CHANGED';
 end if;
end;
$reviewed_hooks$;
do $security_preflight$
declare browser_role record;
begin
 if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('realtime.messages') and relrowsecurity) then
   raise exception 'BLOCKED_MESSAGES_RLS';
 end if;
 if not exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='realtime.messages'::regclass and a.attname='private' and not a.attisdropped
     and a.atttypid='boolean'::regtype and pg_catalog.pg_get_expr(d.adbin,d.adrelid)='false') then
   raise exception 'BLOCKED_PRIVATE_DEFAULT_DIFFERS_FROM_QUERY138';
 end if;
 if not exists(select 1 from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('public.is_admin()')
   and p.prosecdef and p.prorettype='boolean'::regtype and not p.proretset
   and pg_catalog.md5(p.prosrc)='d4a34f1ee6fba504cd9992741be4926e'
   and coalesce('search_path=""'=any(p.proconfig),false)
   and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')) then
   raise exception 'BLOCKED_IS_ADMIN_CONTRACT';
 end if;
 if not pg_catalog.has_table_privilege('authenticated','realtime.messages','SELECT') then
   raise exception 'BLOCKED_SELECT_PRIVILEGE';
 end if;
 for browser_role in select * from pg_catalog.pg_roles where rolname in ('anon','authenticated') loop
   if browser_role.rolsuper or browser_role.rolbypassrls or exists(select 1 from pg_catalog.pg_roles privileged
     where (privileged.rolsuper or privileged.rolbypassrls or privileged.oid=(select relowner from pg_catalog.pg_class where oid='realtime.messages'::regclass))
       and pg_catalog.pg_has_role(browser_role.oid,privileged.oid,'MEMBER')) then
     raise exception 'BLOCKED_BROWSER_PRIVILEGED_MEMBERSHIP';
   end if;
 end loop;
 -- Even a permissive expression can raise an SQL error. Do not silently approve
 -- additional SELECT/ALL policies for authenticated/anon or inherited roles.
 if exists(select 1 from pg_catalog.pg_policy p cross join pg_catalog.pg_roles br
   where p.polrelid='realtime.messages'::regclass and p.polcmd in ('r','*')
     and br.rolname in ('authenticated','anon')
     and p.polname not in ('admin_photo_receive','admin_photo_receive_guard','admin_photo_anon_guard')
     and exists(select 1 from unnest(p.polroles) z(role_oid) where
       case when z.role_oid=0 then true else pg_catalog.pg_has_role(br.oid,z.role_oid,'USAGE') end)) then
   raise exception 'BLOCKED_ADDITIONAL_SELECT_POLICY_REVIEW_REQUIRED';
 end if;
end;
$security_preflight$;
-- Capture ALL relevant existing contracts, including gate and all six policies.
create temp table ap4x__before on commit drop as
with
-- BEGIN CONTRACT SNAPSHOT
contracts(kind,key,value) as (
 select 'function'::text,n.nspname||'.'||p.oid::regprocedure::text,
   jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl)
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private') and p.prokind='f'
 union all select 'relation',n.nspname||'.'||c.relname,
   jsonb_build_object('owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private') and c.relkind in ('r','p','v','m','f')
 union all select 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
   jsonb_build_object('cmd',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles,
     'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
 from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private')
 union all select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,
   jsonb_build_object('def',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private') and not t.tgisinternal
 union all select 'event_trigger',e.evtname::text,
   jsonb_build_object('event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,
     'owner',e.evtowner,'definition',pg_catalog.pg_get_functiondef(e.evtfoid))
 from pg_catalog.pg_event_trigger e
)
-- END CONTRACT SNAPSHOT
select * from contracts;
create temp table ap4x__evidence on commit drop as
select pg_catalog.md5(string_agg(kind||'|'||key||'|'||value::text,E'\n' order by kind,key)) baseline_fingerprint,
 pg_catalog.pg_backend_pid() execution_backend_pid,
 (select backend_start from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid()) backend_started,
 (select xact_start from pg_catalog.pg_stat_activity where pid=pg_catalog.pg_backend_pid()) transaction_started
from pg_temp.ap4x__before;
create temp table ap4x__checks(check_name text primary key,ok boolean not null) on commit drop;
-- Catalog comparator only. No rows or role grants on this TEMP relation.
create temp table ap4x__expected(topic text,extension text,private boolean) on commit drop;
-- BEGIN EXACT OLD POLICIES
create policy admin_photo_receive on pg_temp.ap4x__expected
as permissive for select to authenticated
using (
  topic = 'admin:photo-overview:v1'
  and realtime.topic() = 'admin:photo-overview:v1'
  and extension = 'broadcast' and private is true
  and auth.uid() is not null and public.is_admin() is true
);

create policy admin_photo_receive_guard on pg_temp.ap4x__expected
as restrictive for select to authenticated
using (case
  when topic = 'admin:photo-overview:v1'
    or realtime.topic() = 'admin:photo-overview:v1' then
    topic = 'admin:photo-overview:v1'
    and extension = 'broadcast' and private is true
    and auth.uid() is not null and public.is_admin() is true
  else true end
);

create policy admin_photo_anon_guard on pg_temp.ap4x__expected
as restrictive for select to anon
using (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);

create policy admin_photo_insert_guard on pg_temp.ap4x__expected
as restrictive for insert to anon, authenticated
with check (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);

create policy admin_photo_update_guard on pg_temp.ap4x__expected
as restrictive for update to anon, authenticated
using (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
)
with check (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);

create policy admin_photo_delete_guard on pg_temp.ap4x__expected
as restrictive for delete to anon, authenticated
using (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);
-- END EXACT OLD POLICIES
insert into pg_temp.ap4x__checks
select 'BEFORE_POLICY.'||e.polname,
 coalesce(a.polcmd=e.polcmd and a.polpermissive=e.polpermissive and a.polroles=e.polroles
   and pg_catalog.pg_get_expr(a.polqual,a.polrelid) is not distinct from pg_catalog.pg_get_expr(e.polqual,e.polrelid)
   and pg_catalog.pg_get_expr(a.polwithcheck,a.polrelid) is not distinct from pg_catalog.pg_get_expr(e.polwithcheck,e.polrelid),false)
from pg_catalog.pg_policy e left join pg_catalog.pg_policy a on a.polrelid='realtime.messages'::regclass and a.polname=e.polname
where e.polrelid='pg_temp.ap4x__expected'::regclass;
do $assert_BEFORE$
begin
 if (select count(*) from pg_temp.ap4x__checks where check_name like 'BEFORE_POLICY.%')<>6
    or exists(select 1 from pg_temp.ap4x__checks where not ok) then
   raise exception 'BLOCKED_BEFORE_POLICY_MISMATCH';
 end if;
end;
$assert_BEFORE$;
-- BEGIN TARGET POLICY CHANGE
alter policy admin_photo_receive on realtime.messages
using (
  topic = 'admin:photo-overview:v1'
  and realtime.topic() = 'admin:photo-overview:v1'
  and extension = 'broadcast'
  and auth.uid() is not null and public.is_admin() is true
);

alter policy admin_photo_receive_guard on realtime.messages
using (case
  when topic = 'admin:photo-overview:v1'
    or realtime.topic() = 'admin:photo-overview:v1' then
    topic = 'admin:photo-overview:v1'
    and extension = 'broadcast'
    and auth.uid() is not null and public.is_admin() is true
  else true end
);
-- END TARGET POLICY CHANGE
-- Apply the identical new expressions to the TEMP comparator only.
alter policy admin_photo_receive on pg_temp.ap4x__expected
using (
  topic = 'admin:photo-overview:v1'
  and realtime.topic() = 'admin:photo-overview:v1'
  and extension = 'broadcast'
  and auth.uid() is not null and public.is_admin() is true
);

alter policy admin_photo_receive_guard on pg_temp.ap4x__expected
using (case
  when topic = 'admin:photo-overview:v1'
    or realtime.topic() = 'admin:photo-overview:v1' then
    topic = 'admin:photo-overview:v1'
    and extension = 'broadcast'
    and auth.uid() is not null and public.is_admin() is true
  else true end
);
insert into pg_temp.ap4x__checks
select 'AFTER_POLICY.'||e.polname,
 coalesce(a.polcmd=e.polcmd and a.polpermissive=e.polpermissive and a.polroles=e.polroles
   and pg_catalog.pg_get_expr(a.polqual,a.polrelid) is not distinct from pg_catalog.pg_get_expr(e.polqual,e.polrelid)
   and pg_catalog.pg_get_expr(a.polwithcheck,a.polrelid) is not distinct from pg_catalog.pg_get_expr(e.polwithcheck,e.polrelid),false)
from pg_catalog.pg_policy e left join pg_catalog.pg_policy a on a.polrelid='realtime.messages'::regclass and a.polname=e.polname
where e.polrelid='pg_temp.ap4x__expected'::regclass;
do $assert_AFTER$
begin
 if (select count(*) from pg_temp.ap4x__checks where check_name like 'AFTER_POLICY.%')<>6
    or exists(select 1 from pg_temp.ap4x__checks where not ok) then
   raise exception 'BLOCKED_AFTER_POLICY_MISMATCH';
 end if;
end;
$assert_AFTER$;
create temp table ap4x__after on commit drop as
with
-- BEGIN CONTRACT SNAPSHOT
contracts(kind,key,value) as (
 select 'function'::text,n.nspname||'.'||p.oid::regprocedure::text,
   jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl)
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private') and p.prokind='f'
 union all select 'relation',n.nspname||'.'||c.relname,
   jsonb_build_object('owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity)
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private') and c.relkind in ('r','p','v','m','f')
 union all select 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
   jsonb_build_object('cmd',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles,
     'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
 from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private')
 union all select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,
   jsonb_build_object('def',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','auth','storage','repair_image_private','realtime','admin_photo_private') and not t.tgisinternal
 union all select 'event_trigger',e.evtname::text,
   jsonb_build_object('event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,
     'owner',e.evtowner,'definition',pg_catalog.pg_get_functiondef(e.evtfoid))
 from pg_catalog.pg_event_trigger e
)
-- END CONTRACT SNAPSHOT
select * from contracts;
insert into pg_temp.ap4x__checks
select 'ONLY_TWO_POLICY_EXPRESSIONS_CHANGED',
 not exists(
  select 1 from pg_temp.ap4x__before b full join pg_temp.ap4x__after a using(kind,key)
  where case when coalesce(a.kind,b.kind)='policy' and coalesce(a.key,b.key) in
   ('realtime.messages.admin_photo_receive','realtime.messages.admin_photo_receive_guard')
    then (a.value-'using') is distinct from (b.value-'using')
    else a.value is distinct from b.value end
 ) and (select count(*) from pg_temp.ap4x__before b join pg_temp.ap4x__after a using(kind,key)
        where a.value is distinct from b.value)=2;
insert into pg_temp.ap4x__checks
select 'BASELINE_EVIDENCE_AVAILABLE',coalesce(baseline_fingerprint ~ '^[0-9a-f]{32}$'
 and execution_backend_pid>0 and backend_started is not null and transaction_started>=backend_started,false)
from pg_temp.ap4x__evidence;
do $assert_final$
begin
 if (select count(*) from pg_temp.ap4x__checks)<>14 or exists(select 1 from pg_temp.ap4x__checks where not ok) then
   raise exception 'BLOCKED_4X_FINAL_CHECK';
 end if;
end;
$assert_final$;
-- This permanent candidate is NOT the rehearsal. Separate approval required.
select check_name,case when ok then 'PASS' else 'FAIL' end status from pg_temp.ap4x__checks order by check_name;
commit;
