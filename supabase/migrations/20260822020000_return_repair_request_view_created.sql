begin;

drop function public.record_repair_request_view(uuid);

create function public.record_repair_request_view(
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  inserted_rows integer;
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

  if not exists (
    select 1
    from public.repair_requests request
    where request.id = p_request_id
  ) then
    raise exception 'Repair request not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.repair_requests request
    where request.id = p_request_id
      and request.status = 'open'
      and (
        coalesce(request.request_type, 'repair') = 'repair'
        or (
          request.request_type = 'direct_request'
          and request.target_workshop_id = current_user_id
        )
      )
  ) then
    raise exception 'Repair request is not visible to this workshop'
      using errcode = '42501';
  end if;

  insert into public.repair_request_views (
    request_id,
    workshop_user_id
  )
  values (
    p_request_id,
    current_user_id
  )
  on conflict (request_id, workshop_user_id) do nothing;

  get diagnostics inserted_rows = row_count;

  return inserted_rows = 1;
end;
$$;

revoke all on function public.record_repair_request_view(uuid) from public;
revoke all on function public.record_repair_request_view(uuid) from anon;
grant execute on function public.record_repair_request_view(uuid)
to authenticated;

commit;
