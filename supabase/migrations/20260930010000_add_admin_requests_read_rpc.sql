begin;

create or replace function public.get_admin_requests(
  p_search text default null,
  p_status text default null,
  p_category text default null,
  p_direction text default 'desc',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 25
)
returns table (
  request_id uuid,
  category text,
  status text,
  request_type text,
  created_at timestamptz,
  customer_display_name text,
  city text,
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
declare
  normalized_search text := nullif(
    pg_catalog.lower(pg_catalog.btrim(p_search)),
    ''
  );
  normalized_status text := nullif(
    pg_catalog.lower(pg_catalog.btrim(p_status)),
    ''
  );
  normalized_category text := nullif(
    pg_catalog.lower(pg_catalog.btrim(p_category)),
    ''
  );
  normalized_direction text := pg_catalog.lower(pg_catalog.btrim(p_direction));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Not authorized.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = '22023',
      message = 'Invalid page size.';
  end if;

  if p_search is not null
    and pg_catalog.char_length(pg_catalog.btrim(p_search)) > 100
  then
    raise exception using
      errcode = '22023',
      message = 'Search is too long.';
  end if;

  if p_status is not null
    and normalized_status is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid status filter.';
  end if;

  if normalized_status is not null
    and normalized_status not in (
      'open',
      'matched',
      'in_progress',
      'completed',
      'closed'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid status filter.';
  end if;

  if p_category is not null
    and normalized_category is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid category filter.';
  end if;

  if normalized_category is not null
    and normalized_category not in (
      'bodywork',
      'mechanical',
      'wheels',
      'towing'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid category filter.';
  end if;

  if normalized_direction is null
    or normalized_direction not in ('asc', 'desc')
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid sort direction.';
  end if;

  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  end if;

  return query
  with candidates as (
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
      end as request_category,
      request.status,
      coalesce(request.request_type, 'repair') as normalized_request_type,
      request.created_at,
      coalesce(
        nullif(pg_catalog.btrim(customer_profile.display_name), ''),
        'Client'
      ) as customer_name,
      request.city,
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
      ) as associated_workshop_name,
      accepted_offer.price::text as offer_price,
      appointment.status as latest_appointment_status,
      case
        when appointment.status = 'confirmed'
          then appointment.appointment_date::text
        else coalesce(
          appointment.proposed_date,
          appointment.appointment_date
        )::text
      end as effective_appointment_date,
      case
        when appointment.status = 'confirmed'
          then appointment.appointment_time::text
        else coalesce(
          appointment.proposed_time,
          appointment.appointment_time
        )::text
      end as effective_appointment_time
    from public.repair_requests as request
    left join public.profiles as customer_profile
      on customer_profile.id = request.user_id
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
    where coalesce(request.request_type, 'repair') in (
      'repair',
      'direct_request'
    )
  ),
  filtered as (
    select candidate.*
    from candidates as candidate
    where (
      normalized_search is null
      or pg_catalog.strpos(
        pg_catalog.lower(
          pg_catalog.concat_ws(
            ' ',
            coalesce(candidate.customer_name, ''),
            coalesce(candidate.associated_workshop_name, ''),
            coalesce(candidate.city, ''),
            coalesce(candidate.request_category, '')
          )
        ),
        normalized_search
      ) > 0
    )
      and (
        normalized_status is null
        or candidate.status = normalized_status
      )
      and (
        normalized_category is null
        or candidate.request_category = normalized_category
      )
  ),
  paged as (
    select filtered_candidate.*
    from filtered as filtered_candidate
    where p_cursor_id is null
      or (
        normalized_direction = 'asc'
        and (filtered_candidate.created_at, filtered_candidate.id)
          > (p_cursor_created_at, p_cursor_id)
      )
      or (
        normalized_direction = 'desc'
        and (filtered_candidate.created_at, filtered_candidate.id)
          < (p_cursor_created_at, p_cursor_id)
      )
    order by
      case
        when normalized_direction = 'asc'
          then filtered_candidate.created_at
      end asc,
      case
        when normalized_direction = 'desc'
          then filtered_candidate.created_at
      end desc,
      case when normalized_direction = 'asc' then filtered_candidate.id end asc,
      case when normalized_direction = 'desc' then filtered_candidate.id end desc
    limit p_limit
  )
  select
    page.id,
    page.request_category,
    page.status,
    page.normalized_request_type,
    page.created_at,
    page.customer_name,
    page.city,
    page.associated_workshop_name,
    page.offer_price,
    page.latest_appointment_status,
    page.effective_appointment_date,
    page.effective_appointment_time
  from paged as page
  order by
    case
      when normalized_direction = 'asc'
        then page.created_at
    end asc,
    case
      when normalized_direction = 'desc'
        then page.created_at
    end desc,
    case when normalized_direction = 'asc' then page.id end asc,
    case when normalized_direction = 'desc' then page.id end desc;
end;
$function$;

revoke all on function public.get_admin_requests(
  text,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_admin_requests(
  text,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer
) to authenticated;

commit;
