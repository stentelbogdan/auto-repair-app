begin;

create or replace function public.get_admin_customer_detail(
  p_customer_id uuid
)
returns table (
  customer_id uuid,
  display_name text,
  city text,
  profile_created_at timestamptz,
  total_requests bigint,
  open_requests bigint,
  in_progress_jobs bigint,
  completed_jobs bigint
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

  if p_customer_id is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid customer.';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(pg_catalog.btrim(profile.display_name), ''),
      'Client'
    ),
    profile.city,
    profile.created_at,
    coalesce(requests.total_requests, 0::bigint),
    coalesce(requests.open_requests, 0::bigint),
    coalesce(requests.in_progress_jobs, 0::bigint),
    coalesce(requests.completed_jobs, 0::bigint)
  from public.profiles as profile
  left join lateral (
    select
      pg_catalog.count(*) as total_requests,
      pg_catalog.count(*) filter (
        where request.status = 'open'
      ) as open_requests,
      pg_catalog.count(*) filter (
        where request.status = 'in_progress'
      ) as in_progress_jobs,
      pg_catalog.count(*) filter (
        where request.status = 'completed'
      ) as completed_jobs
    from public.repair_requests as request
    where request.user_id = profile.id
      and coalesce(request.request_type, 'repair') in (
        'repair',
        'direct_request'
      )
  ) as requests on true
  where profile.id = p_customer_id
    and 'customer' = any(coalesce(profile.role, '{}'::text[]));
end;
$function$;

revoke all on function public.get_admin_customer_detail(uuid) from public;
revoke all on function public.get_admin_customer_detail(uuid) from anon;
revoke all on function public.get_admin_customer_detail(uuid) from authenticated;
grant execute on function public.get_admin_customer_detail(uuid) to authenticated;

create or replace function public.get_admin_customer_requests(
  p_customer_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_request_id uuid default null,
  p_limit integer default 25
)
returns table (
  request_id uuid,
  category text,
  status text,
  request_type text,
  created_at timestamptz,
  workshop_name text,
  accepted_offer_price text,
  appointment_status text,
  appointment_date text,
  appointment_time text
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

  if p_customer_id is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid customer.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = '22023',
      message = 'Invalid page size.';
  end if;

  if (p_cursor_created_at is null) <> (p_cursor_request_id is null) then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_customer_id
      and 'customer' = any(coalesce(profile.role, '{}'::text[]))
  ) then
    return;
  end if;

  return query
  select
    request.id,
    case
      when request.service_type in (
        'bodywork',
        'mechanical',
        'wheels',
        'towing'
      ) then request.service_type
      else 'bodywork'
    end,
    request.status,
    coalesce(request.request_type, 'repair'),
    request.created_at,
    coalesce(
      nullif(pg_catalog.btrim(accepted_workshop_profile.workshop_name), ''),
      nullif(pg_catalog.btrim(accepted_offer.workshop_name), ''),
      nullif(pg_catalog.btrim(target_workshop_profile.workshop_name), ''),
      case
        when accepted_offer.id is not null
          or request.target_workshop_id is not null
        then 'Service'
        else null
      end
    ),
    accepted_offer.price::text,
    appointment.status,
    case
      when appointment.status = 'confirmed'
        then appointment.appointment_date::text
      else coalesce(
        appointment.proposed_date,
        appointment.appointment_date
      )::text
    end,
    case
      when appointment.status = 'confirmed'
        then appointment.appointment_time::text
      else coalesce(
        appointment.proposed_time,
        appointment.appointment_time
      )::text
    end
  from public.repair_requests as request
  left join public.repair_offers as accepted_offer
    on accepted_offer.id = request.accepted_offer_id
   and accepted_offer.request_id = request.id
   and accepted_offer.status = 'accepted'
  left join public.profiles as accepted_workshop_profile
    on accepted_workshop_profile.id = accepted_offer.workshop_user_id
  left join public.profiles as target_workshop_profile
    on target_workshop_profile.id = request.target_workshop_id
   and coalesce(request.request_type, 'repair') = 'direct_request'
  left join lateral (
    select
      candidate_appointment.status,
      candidate_appointment.appointment_date,
      candidate_appointment.appointment_time,
      candidate_appointment.proposed_date,
      candidate_appointment.proposed_time
    from public.repair_appointments as candidate_appointment
    where candidate_appointment.request_id = request.id
      and candidate_appointment.offer_id = accepted_offer.id
      and candidate_appointment.workshop_id = accepted_offer.workshop_user_id
    order by
      candidate_appointment.updated_at desc nulls last,
      candidate_appointment.id desc
    limit 1
  ) as appointment on true
  where request.user_id = p_customer_id
    and coalesce(request.request_type, 'repair') in (
      'repair',
      'direct_request'
    )
    and (
      p_cursor_request_id is null
      or (request.created_at, request.id)
        < (p_cursor_created_at, p_cursor_request_id)
    )
  order by request.created_at desc, request.id desc
  limit p_limit;
end;
$function$;

revoke all on function public.get_admin_customer_requests(
  uuid,
  timestamptz,
  uuid,
  integer
) from public;
revoke all on function public.get_admin_customer_requests(
  uuid,
  timestamptz,
  uuid,
  integer
) from anon;
revoke all on function public.get_admin_customer_requests(
  uuid,
  timestamptz,
  uuid,
  integer
) from authenticated;
grant execute on function public.get_admin_customer_requests(
  uuid,
  timestamptz,
  uuid,
  integer
) to authenticated;

commit;
