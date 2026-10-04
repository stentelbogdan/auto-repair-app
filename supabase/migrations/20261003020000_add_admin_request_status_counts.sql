begin;

create function public.get_admin_request_status_counts()
returns table (
  open_count bigint,
  matched_count bigint,
  in_progress_count bigint,
  completed_count bigint,
  closed_count bigint
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
  select
    pg_catalog.count(*) filter (where request.status = 'open')
      as open_count,
    pg_catalog.count(*) filter (where request.status = 'matched')
      as matched_count,
    pg_catalog.count(*) filter (where request.status = 'in_progress')
      as in_progress_count,
    pg_catalog.count(*) filter (where request.status = 'completed')
      as completed_count,
    pg_catalog.count(*) filter (where request.status = 'closed')
      as closed_count
  from public.repair_requests as request
  where coalesce(request.request_type, 'repair') in (
    'repair',
    'direct_request'
  );
end;
$function$;

revoke all on function public.get_admin_request_status_counts()
  from public, anon, authenticated;
grant execute on function public.get_admin_request_status_counts()
  to authenticated;

commit;
