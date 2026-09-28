begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = auth.uid()
        and 'admin' = any(
          coalesce(profile.role, '{}'::text[])
        )
    );
$function$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create or replace function public.get_admin_overview()
returns table (
  total_users bigint,
  total_customers bigint,
  total_workshops bigint,
  open_requests bigint,
  in_progress_jobs bigint,
  completed_jobs bigint,
  closed_requests bigint,
  total_reviews bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Not authorized.';
  end if;

  return query
  with profile_counts as (
    select
      pg_catalog.count(*) as total_users,
      pg_catalog.count(*) filter (
        where 'customer' = any(
          coalesce(profile.role, '{}'::text[])
        )
      ) as total_customers,
      pg_catalog.count(*) filter (
        where 'workshop' = any(
          coalesce(profile.role, '{}'::text[])
        )
      ) as total_workshops
    from public.profiles as profile
  ),
  request_counts as (
    select
      pg_catalog.count(*) filter (where request.status = 'open') as open_requests,
      pg_catalog.count(*) filter (where request.status = 'in_progress') as in_progress_jobs,
      pg_catalog.count(*) filter (where request.status = 'completed') as completed_jobs,
      pg_catalog.count(*) filter (where request.status = 'closed') as closed_requests
    from public.repair_requests as request
  ),
  review_counts as (
    select pg_catalog.count(*) as total_reviews
    from public.reviews
  )
  select
    profile_counts.total_users,
    profile_counts.total_customers,
    profile_counts.total_workshops,
    request_counts.open_requests,
    request_counts.in_progress_jobs,
    request_counts.completed_jobs,
    request_counts.closed_requests,
    review_counts.total_reviews
  from profile_counts
  cross join request_counts
  cross join review_counts;
end;
$function$;

revoke all on function public.get_admin_overview() from public, anon;
grant execute on function public.get_admin_overview() to authenticated, service_role;

commit;
