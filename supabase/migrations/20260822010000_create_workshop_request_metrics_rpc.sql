create or replace function public.get_workshop_request_metrics(
  p_request_ids uuid[]
)
returns table (
  request_id uuid,
  view_count bigint,
  offer_count bigint
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

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = current_user_id
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  ) then
    raise exception 'Workshop role required' using errcode = '42501';
  end if;

  return query
  with requested_ids as (
    select distinct input.request_id
    from unnest(coalesce(p_request_ids, array[]::uuid[]))
      as input(request_id)
  )
  select
    request.id as request_id,
    view_metrics.view_count,
    offer_metrics.offer_count
  from requested_ids input
  join public.repair_requests request
    on request.id = input.request_id
  cross join lateral (
    select count(*) as view_count
    from public.repair_request_views request_view
    where request_view.request_id = request.id
  ) view_metrics
  cross join lateral (
    select count(*) as offer_count
    from public.repair_offers offer
    where offer.request_id = request.id
  ) offer_metrics
  where request.status = 'open'
    and (
      coalesce(request.request_type, 'repair') = 'repair'
      or (
        request.request_type = 'direct_request'
        and request.target_workshop_id = current_user_id
      )
    );
end;
$$;

revoke all on function public.get_workshop_request_metrics(uuid[]) from public;
revoke all on function public.get_workshop_request_metrics(uuid[]) from anon;
grant execute on function public.get_workshop_request_metrics(uuid[])
to authenticated;
