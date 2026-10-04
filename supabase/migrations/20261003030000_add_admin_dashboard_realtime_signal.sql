begin;

create table public.admin_dashboard_refresh_signal (
  id boolean primary key default true,
  revision bigint not null default 0,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint admin_dashboard_refresh_signal_singleton check (id),
  constraint admin_dashboard_refresh_signal_revision_nonnegative
    check (revision >= 0)
);

insert into public.admin_dashboard_refresh_signal (id, revision, updated_at)
values (true, 0, pg_catalog.now());

alter table public.admin_dashboard_refresh_signal enable row level security;

revoke all privileges
on table public.admin_dashboard_refresh_signal
from public, anon, authenticated;

grant select
on table public.admin_dashboard_refresh_signal
to authenticated;

create policy admin_dashboard_refresh_signal_select_admin
on public.admin_dashboard_refresh_signal
for select
to authenticated
using ((select public.is_admin()));

create function public.invalidate_admin_dashboard_overview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.admin_dashboard_refresh_signal as signal (
    id,
    revision,
    updated_at
  )
  values (
    true,
    1,
    pg_catalog.now()
  )
  on conflict (id) do update
  set
    revision = signal.revision + 1,
    updated_at = pg_catalog.now();

  return null;
end;
$function$;

revoke all
on function public.invalidate_admin_dashboard_overview()
from public, anon, authenticated, service_role;

create trigger invalidate_admin_dashboard_on_profile_insert
after insert on public.profiles
for each row
when (
  'customer' = any(coalesce(new.role, '{}'::text[]))
  or 'workshop' = any(coalesce(new.role, '{}'::text[]))
)
execute function public.invalidate_admin_dashboard_overview();

create trigger invalidate_admin_dashboard_on_profile_update
after update of role on public.profiles
for each row
when (
  (
    'customer' = any(coalesce(old.role, '{}'::text[]))
  ) is distinct from (
    'customer' = any(coalesce(new.role, '{}'::text[]))
  )
  or (
    'workshop' = any(coalesce(old.role, '{}'::text[]))
  ) is distinct from (
    'workshop' = any(coalesce(new.role, '{}'::text[]))
  )
)
execute function public.invalidate_admin_dashboard_overview();

create trigger invalidate_admin_dashboard_on_profile_delete
after delete on public.profiles
for each row
when (
  'customer' = any(coalesce(old.role, '{}'::text[]))
  or 'workshop' = any(coalesce(old.role, '{}'::text[]))
)
execute function public.invalidate_admin_dashboard_overview();

create trigger invalidate_admin_dashboard_on_request_insert
after insert on public.repair_requests
for each row
when (new.status = 'open')
execute function public.invalidate_admin_dashboard_overview();

create trigger invalidate_admin_dashboard_on_request_update
after update of status on public.repair_requests
for each row
when (
  coalesce(old.status = 'open', false)
    is distinct from coalesce(new.status = 'open', false)
)
execute function public.invalidate_admin_dashboard_overview();

create trigger invalidate_admin_dashboard_on_request_delete
after delete on public.repair_requests
for each row
when (old.status = 'open')
execute function public.invalidate_admin_dashboard_overview();

create trigger invalidate_admin_dashboard_on_review_change
after insert or delete on public.reviews
for each row
execute function public.invalidate_admin_dashboard_overview();

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_dashboard_refresh_signal'
  ) then
    alter publication supabase_realtime
      add table public.admin_dashboard_refresh_signal;
  end if;
end;
$block$;

commit;
