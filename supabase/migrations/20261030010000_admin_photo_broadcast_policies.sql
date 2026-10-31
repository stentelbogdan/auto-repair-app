-- 4G local candidate only. No triggers, no realtime.send, no business mutation.
-- Install only after policy/contract review in TEST; no dependency on blocked 4D migration.
begin;
do $identity$
begin
 if current_database() <> 'postgres' or current_user <> 'postgres' or session_user <> 'postgres'
   or (select system_identifier::text from pg_catalog.pg_control_system()) is distinct from '7692131729119822239' then
   raise exception 'BLOCKED_TEST_IDENTITY';
 end if;
 if current_setting('app.admin_photo_policy_review',true) is distinct from '4g-v1' then
   raise exception 'BLOCKED_POLICY_REVIEW_REQUIRED';
 end if;
 if not exists(select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('realtime.messages') and relrowsecurity)
   or pg_catalog.to_regprocedure('public.is_admin()') is null then raise exception 'BLOCKED_CONTRACT'; end if;
 if not exists(select 1 from pg_catalog.pg_roles where rolname='service_role' and rolbypassrls)
   or not exists(select 1 from pg_catalog.pg_roles where rolname='postgres' and rolbypassrls) then
   raise exception 'BLOCKED_PRIVILEGE_CONTRACT';
 end if;
end;
$identity$;
create policy admin_photo_receive on realtime.messages
as permissive for select to authenticated
using (
  topic = 'admin:photo-overview:v1'
  and realtime.topic() = 'admin:photo-overview:v1'
  and extension = 'broadcast' and private is true
  and auth.uid() is not null and public.is_admin() is true
);

create policy admin_photo_receive_guard on realtime.messages
as restrictive for select to authenticated
using (case
  when topic = 'admin:photo-overview:v1'
    or realtime.topic() = 'admin:photo-overview:v1' then
    topic = 'admin:photo-overview:v1'
    and extension = 'broadcast' and private is true
    and auth.uid() is not null and public.is_admin() is true
  else true end
);

create policy admin_photo_anon_guard on realtime.messages
as restrictive for select to anon
using (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);

create policy admin_photo_insert_guard on realtime.messages
as restrictive for insert to anon, authenticated
with check (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);

create policy admin_photo_update_guard on realtime.messages
as restrictive for update to anon, authenticated
using (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
)
with check (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);

create policy admin_photo_delete_guard on realtime.messages
as restrictive for delete to anon, authenticated
using (
  topic is distinct from 'admin:photo-overview:v1'
  and realtime.topic() is distinct from 'admin:photo-overview:v1'
);

commit;
