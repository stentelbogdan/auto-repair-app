create or replace function public.get_customer_request_view_counts(
  p_request_ids uuid[]
)
returns table (
  request_id uuid,
  view_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return query
  with requested_ids as (
    select distinct input.request_id
    from unnest(coalesce(p_request_ids, array[]::uuid[]))
      as input(request_id)
  )
  select
    request.id as request_id,
    count(request_view.request_id) as view_count
  from requested_ids input
  join public.repair_requests request
    on request.id = input.request_id
    and request.user_id = current_user_id
  left join public.repair_request_views request_view
    on request_view.request_id = request.id
  group by request.id;
end;
$$;

revoke all on function public.get_customer_request_view_counts(uuid[]) from public;
revoke all on function public.get_customer_request_view_counts(uuid[]) from anon;
grant execute on function public.get_customer_request_view_counts(uuid[])
to authenticated;
