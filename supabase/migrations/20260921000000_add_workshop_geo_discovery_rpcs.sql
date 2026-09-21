create index repair_requests_open_discovery_idx
  on public.repair_requests (
    (coalesce(service_type, 'bodywork')),
    created_at desc,
    id desc
  )
  where status = 'open' and accepted_offer_id is null;

create index repair_requests_open_direct_target_idx
  on public.repair_requests (
    target_workshop_id,
    (coalesce(service_type, 'bodywork')),
    created_at desc,
    id desc
  )
  where status = 'open'
    and accepted_offer_id is null
    and request_type = 'direct_request';

create or replace function public.workshop_discovery_eligible_requests(
  p_service_type text,
  p_radius_override_mode text,
  p_radius_override_km integer
)
returns table (
  request_id uuid,
  service_type text,
  created_at timestamptz,
  request_data jsonb,
  distance_km numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_workshop_id uuid := auth.uid();
begin
  if current_workshop_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = current_workshop_id
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  ) then
    raise exception 'Workshop role required' using errcode = '42501';
  end if;

  if p_service_type is not null
    and p_service_type not in ('bodywork', 'mechanical', 'wheels', 'towing')
  then
    raise exception 'Invalid service type' using errcode = '22023';
  end if;

  if p_radius_override_mode is null
    or p_radius_override_mode not in ('default', 'radius', 'nationwide')
  then
    raise exception 'Invalid radius override mode' using errcode = '22023';
  end if;

  if (
    p_radius_override_mode = 'radius'
    and (
      p_radius_override_km is null
      or p_radius_override_km not between 1 and 1000
    )
  ) or (
    p_radius_override_mode <> 'radius'
    and p_radius_override_km is not null
  ) then
    raise exception 'Invalid radius override' using errcode = '22023';
  end if;

  return query
  select
    request.id as request_id,
    coalesce(request.service_type, 'bodywork') as service_type,
    request.created_at,
    jsonb_build_object(
      'id', request.id,
      'car_brand', request.car_brand,
      'car_model', request.car_model,
      'car_year', request.car_year,
      'city', request.city,
      'license_plate', request.license_plate,
      'damage_type', request.damage_type,
      'service_details', request.service_details,
      'service_type', request.service_type,
      'request_type', request.request_type,
      'target_workshop_id', request.target_workshop_id,
      'description', request.description,
      'images', request.images,
      'status', request.status,
      'accepted_offer_id', request.accepted_offer_id,
      'pickup_lat', request.pickup_lat,
      'pickup_lng', request.pickup_lng,
      'destination_lat', request.destination_lat,
      'destination_lng', request.destination_lng,
      'route_distance_meters', request.route_distance_meters,
      'route_duration_seconds', request.route_duration_seconds,
      'route_paths', request.route_paths,
      'towing_schedule_type', request.towing_schedule_type,
      'towing_requested_at', request.towing_requested_at,
      'towing_requested_timezone', request.towing_requested_timezone,
      'created_at', request.created_at
    ) as request_data,
    case
      when coalesce(request.request_type, 'repair') <> 'repair'
        or service_area.workshop_id is null
        or discovery.request_id is null
        or p_radius_override_mode = 'nationwide'
        or (
          p_radius_override_mode = 'default'
          and service_area.radius_km is null
        )
      then null
      else extensions.ST_Distance(
        service_area.location,
        discovery.location
      ) / 1000.0
    end::numeric as distance_km
  from public.repair_requests request
  left join public.workshop_service_areas service_area
    on service_area.workshop_id = current_workshop_id
  left join public.repair_request_discovery_locations discovery
    on discovery.request_id = request.id
  where request.status = 'open'
    and request.accepted_offer_id is null
    and coalesce(request.service_type, 'bodywork') in (
      'bodywork',
      'mechanical',
      'wheels',
      'towing'
    )
    and (
      p_service_type is null
      or coalesce(request.service_type, 'bodywork') = p_service_type
    )
    and not exists (
      select 1
      from public.repair_offers offer
      where offer.request_id = request.id
        and offer.workshop_user_id = current_workshop_id
    )
    and (
      (
        request.request_type = 'direct_request'
        and request.target_workshop_id = current_workshop_id
      )
      or (
        coalesce(request.request_type, 'repair') = 'repair'
        and (
          service_area.workshop_id is null
          or discovery.request_id is null
          or (
            p_radius_override_mode = 'nationwide'
            and service_area.country_code = discovery.country_code
          )
          or (
            p_radius_override_mode = 'default'
            and service_area.radius_km is null
            and service_area.country_code = discovery.country_code
          )
          or (
            (
              p_radius_override_mode = 'radius'
              or (
                p_radius_override_mode = 'default'
                and service_area.radius_km is not null
              )
            )
            and extensions.ST_DWithin(
              service_area.location,
              discovery.location,
              case
                when p_radius_override_mode = 'radius'
                  then p_radius_override_km
                else service_area.radius_km
              end * 1000.0
            )
          )
        )
      )
    );
end;
$function$;

revoke all on function public.workshop_discovery_eligible_requests(
  text,
  text,
  integer
) from public, anon, authenticated;

create or replace function public.get_workshop_discovery_feed(
  p_service_type text,
  p_page_size integer default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_radius_override_mode text default 'default',
  p_radius_override_km integer default null
)
returns table (
  request_id uuid,
  request_data jsonb,
  distance_km numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_service_type is null then
    raise exception 'Service type is required' using errcode = '22023';
  end if;

  if p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Page size must be between 1 and 100'
      using errcode = '22023';
  end if;

  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'Both cursor values are required'
      using errcode = '22023';
  end if;

  return query
  select
    eligible.request_id,
    eligible.request_data,
    eligible.distance_km,
    eligible.created_at
  from public.workshop_discovery_eligible_requests(
    p_service_type,
    p_radius_override_mode,
    p_radius_override_km
  ) eligible
  where p_cursor_created_at is null
    or (eligible.created_at, eligible.request_id)
      < (p_cursor_created_at, p_cursor_id)
  order by eligible.created_at desc, eligible.request_id desc
  limit p_page_size;
end;
$function$;

revoke all on function public.get_workshop_discovery_feed(
  text,
  integer,
  timestamptz,
  uuid,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.get_workshop_discovery_feed(
  text,
  integer,
  timestamptz,
  uuid,
  text,
  integer
) to authenticated;

create or replace function public.get_workshop_discovery_counts(
  p_radius_override_mode text default 'default',
  p_radius_override_km integer default null
)
returns table (
  service_type text,
  request_count bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    categories.service_type,
    count(eligible.request_id)::bigint as request_count
  from (
    values
      ('bodywork'::text),
      ('mechanical'::text),
      ('wheels'::text),
      ('towing'::text)
  ) categories(service_type)
  left join public.workshop_discovery_eligible_requests(
    null,
    p_radius_override_mode,
    p_radius_override_km
  ) eligible
    on eligible.service_type = categories.service_type
  group by categories.service_type
  order by categories.service_type;
$function$;

revoke all on function public.get_workshop_discovery_counts(
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.get_workshop_discovery_counts(
  text,
  integer
) to authenticated;
