create or replace function public.get_workshop_request_client_names(
  p_request_ids uuid[]
)
returns table (
  request_id uuid,
  client_name text
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
    coalesce(
      nullif(btrim(client_profile.display_name), ''),
      nullif(btrim(client_profile.full_name), ''),
      'Client'
    ) as client_name
  from requested_ids input
  join public.repair_requests request
    on request.id = input.request_id
  left join public.profiles client_profile
    on client_profile.id = request.user_id
  where (
    coalesce(request.request_type, 'repair') = 'repair'
    and (
      request.status = 'open'
      or exists (
        select 1
        from public.repair_offers offer
        where offer.request_id = request.id
          and offer.workshop_user_id = current_user_id
      )
    )
  )
  or (
    request.request_type = 'direct_request'
    and request.target_workshop_id = current_user_id
  );
end;
$$;

revoke all on function public.get_workshop_request_client_names(uuid[])
from public;
revoke all on function public.get_workshop_request_client_names(uuid[])
from anon;
grant execute on function public.get_workshop_request_client_names(uuid[])
to authenticated;
