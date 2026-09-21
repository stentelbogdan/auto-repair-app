do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.repair_request_discovery_locations'::regclass
      and conname = 'repair_request_discovery_locations_source_check'
  ) then
    alter table public.repair_request_discovery_locations
      add constraint repair_request_discovery_locations_source_check
      check (source in ('locality', 'towing_pickup'));
  end if;
end;
$block$;

create or replace function public.create_repair_request_with_discovery_location(
  p_request jsonb,
  p_discovery jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_user_id uuid := auth.uid();
  created_request_id uuid;
  request_service_type text := coalesce(nullif(btrim(p_request ->> 'service_type'), ''), 'bodywork');
  discovery_source text := nullif(btrim(p_discovery ->> 'source'), '');
  discovery_locality text := nullif(btrim(p_discovery ->> 'locality'), '');
  discovery_postal_code text := nullif(btrim(p_discovery ->> 'postal_code'), '');
  discovery_country_code text := upper(nullif(btrim(p_discovery ->> 'country_code'), ''));
  discovery_lat double precision;
  discovery_lng double precision;
  request_pickup_lat double precision;
  request_pickup_lng double precision;
  request_destination_lat double precision;
  request_destination_lng double precision;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_request is null
    or p_discovery is null
    or jsonb_typeof(p_request) <> 'object'
    or jsonb_typeof(p_discovery) <> 'object'
  then
    raise exception using errcode = '22023', message = 'Invalid request payload.';
  end if;

  begin
    discovery_lat := (p_discovery ->> 'lat')::double precision;
    discovery_lng := (p_discovery ->> 'lng')::double precision;
    request_pickup_lat := nullif(p_request ->> 'pickup_lat', '')::double precision;
    request_pickup_lng := nullif(p_request ->> 'pickup_lng', '')::double precision;
    request_destination_lat := nullif(p_request ->> 'destination_lat', '')::double precision;
    request_destination_lng := nullif(p_request ->> 'destination_lng', '')::double precision;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Invalid request coordinates.';
  end;

  if discovery_locality is null
    or discovery_country_code !~ '^[A-Z]{2}$'
    or discovery_lat is null
    or discovery_lng is null
    or discovery_lat = 'NaN'::double precision
    or discovery_lng = 'NaN'::double precision
    or discovery_lat not between -90 and 90
    or discovery_lng not between -180 and 180
  then
    raise exception using errcode = '22023', message = 'Invalid discovery location.';
  end if;

  if (request_pickup_lat is null) <> (request_pickup_lng is null)
    or (request_destination_lat is null) <> (request_destination_lng is null)
    or (
      request_pickup_lat is not null
      and (
        request_pickup_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        or request_pickup_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        or request_pickup_lat not between -90 and 90
        or request_pickup_lng not between -180 and 180
      )
    )
    or (
      request_destination_lat is not null
      and (
        request_destination_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        or request_destination_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        or request_destination_lat not between -90 and 90
        or request_destination_lng not between -180 and 180
      )
    )
  then
    raise exception using errcode = '22023', message = 'Invalid request coordinates.';
  end if;

  if request_service_type not in ('bodywork', 'mechanical', 'wheels', 'towing') then
    raise exception using errcode = '22023', message = 'Invalid service type.';
  end if;

  if request_service_type = 'towing' and request_pickup_lat is null then
    raise exception using errcode = '22023', message = 'Pickup coordinates are required.';
  end if;

  if (request_service_type = 'towing' and discovery_source <> 'towing_pickup')
    or (request_service_type <> 'towing' and discovery_source <> 'locality')
  then
    raise exception using errcode = '22023', message = 'Invalid discovery source.';
  end if;

  if nullif(btrim(p_request ->> 'city'), '') is distinct from discovery_locality then
    raise exception using errcode = '22023', message = 'Request locality does not match discovery locality.';
  end if;

  if request_service_type = 'towing'
    and (
      request_pickup_lat is distinct from discovery_lat
      or request_pickup_lng is distinct from discovery_lng
    )
  then
    raise exception using errcode = '22023', message = 'Pickup coordinates do not match discovery location.';
  end if;

  insert into public.repair_requests (
    user_id, car_brand, car_model, car_year, city,
    pickup_lat, pickup_lng, destination_lat, destination_lng,
    route_distance_meters, route_duration_seconds, route_paths,
    towing_schedule_type, towing_requested_at, towing_requested_timezone,
    license_plate, damage_type, service_details, description, service_type,
    request_type, target_workshop_id, images, status
  ) values (
    current_user_id,
    p_request ->> 'car_brand',
    p_request ->> 'car_model',
    p_request ->> 'car_year',
    p_request ->> 'city',
    request_pickup_lat,
    request_pickup_lng,
    request_destination_lat,
    request_destination_lng,
    nullif(p_request ->> 'route_distance_meters', '')::integer,
    nullif(p_request ->> 'route_duration_seconds', '')::integer,
    p_request -> 'route_paths',
    nullif(p_request ->> 'towing_schedule_type', ''),
    nullif(p_request ->> 'towing_requested_at', '')::timestamptz,
    nullif(p_request ->> 'towing_requested_timezone', ''),
    nullif(p_request ->> 'license_plate', ''),
    p_request ->> 'damage_type',
    coalesce(p_request -> 'service_details', '[]'::jsonb),
    p_request ->> 'description',
    request_service_type,
    coalesce(nullif(p_request ->> 'request_type', ''), 'repair'),
    nullif(p_request ->> 'target_workshop_id', '')::uuid,
    coalesce(p_request -> 'images', '[]'::jsonb),
    'open'
  )
  returning id into created_request_id;

  insert into public.repair_request_discovery_locations (
    request_id, location, locality, postal_code, country_code, source
  ) values (
    created_request_id,
    extensions.ST_SetSRID(
      extensions.ST_MakePoint(discovery_lng, discovery_lat),
      4326
    )::extensions.geography,
    discovery_locality,
    discovery_postal_code,
    discovery_country_code,
    discovery_source
  );

  return created_request_id;
end;
$function$;

revoke all on function public.create_repair_request_with_discovery_location(jsonb, jsonb)
  from public, anon;
grant execute on function public.create_repair_request_with_discovery_location(jsonb, jsonb)
  to authenticated;

create or replace function public.update_towing_repair_request_with_discovery_location(
  p_request_id uuid,
  p_update jsonb,
  p_discovery jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_user_id uuid := auth.uid();
  locked_request public.repair_requests%rowtype;
  next_pickup_lat double precision := nullif(p_update ->> 'pickup_lat', '')::double precision;
  next_pickup_lng double precision := nullif(p_update ->> 'pickup_lng', '')::double precision;
  next_destination_lat double precision := nullif(p_update ->> 'destination_lat', '')::double precision;
  next_destination_lng double precision := nullif(p_update ->> 'destination_lng', '')::double precision;
  discovery_locality text;
  discovery_postal_code text;
  discovery_country_code text;
  discovery_lat double precision;
  discovery_lng double precision;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_request_id is null
    or p_update is null
    or jsonb_typeof(p_update) <> 'object'
    or (p_discovery is not null and jsonb_typeof(p_discovery) <> 'object')
  then
    raise exception using errcode = '22023', message = 'Invalid update payload.';
  end if;

  select * into locked_request
  from public.repair_requests
  where id = p_request_id
  for update;

  if not found or locked_request.user_id <> current_user_id then
    raise exception using errcode = '42501', message = 'Request not found.';
  end if;
  if coalesce(locked_request.request_type, 'repair') not in ('repair', 'direct_request')
    or locked_request.service_type <> 'towing'
    or locked_request.status <> 'open'
    or locked_request.accepted_offer_id is not null
    or exists (select 1 from public.repair_offers where request_id = p_request_id)
  then
    raise exception using errcode = 'PT409', message = 'Cererea nu mai poate fi modificată.';
  end if;

  if next_pickup_lat is null
    or next_pickup_lng is null
    or (next_destination_lat is null) <> (next_destination_lng is null)
    or next_pickup_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or next_pickup_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or next_pickup_lat not between -90 and 90
    or next_pickup_lng not between -180 and 180
    or (
      next_destination_lat is not null
      and (
        next_destination_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        or next_destination_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
        or next_destination_lat not between -90 and 90
        or next_destination_lng not between -180 and 180
      )
    )
  then
    raise exception using errcode = '22023', message = 'Invalid towing coordinates.';
  end if;

  if (locked_request.pickup_lat is distinct from next_pickup_lat
      or locked_request.pickup_lng is distinct from next_pickup_lng)
    and p_discovery is null
  then
    raise exception using errcode = '22023', message = 'Locația de preluare nu este validată.';
  end if;

  update public.repair_requests set
    car_brand = p_update ->> 'car_brand',
    car_model = p_update ->> 'car_model',
    car_year = p_update ->> 'car_year',
    license_plate = nullif(p_update ->> 'license_plate', ''),
    city = p_update ->> 'city',
    service_details = p_update -> 'service_details',
    pickup_lat = next_pickup_lat,
    pickup_lng = next_pickup_lng,
    destination_lat = next_destination_lat,
    destination_lng = next_destination_lng,
    route_distance_meters = nullif(p_update ->> 'route_distance_meters', '')::integer,
    route_duration_seconds = nullif(p_update ->> 'route_duration_seconds', '')::integer,
    route_paths = p_update -> 'route_paths',
    towing_schedule_type = p_update ->> 'towing_schedule_type',
    towing_requested_at = nullif(p_update ->> 'towing_requested_at', '')::timestamptz,
    towing_requested_timezone = nullif(p_update ->> 'towing_requested_timezone', ''),
    description = p_update ->> 'description',
    images = coalesce(p_update -> 'images', '[]'::jsonb)
  where id = p_request_id;

  if p_discovery is not null then
    discovery_locality := nullif(btrim(p_discovery ->> 'locality'), '');
    discovery_postal_code := nullif(btrim(p_discovery ->> 'postal_code'), '');
    discovery_country_code := upper(nullif(btrim(p_discovery ->> 'country_code'), ''));
    discovery_lat := (p_discovery ->> 'lat')::double precision;
    discovery_lng := (p_discovery ->> 'lng')::double precision;

    if p_discovery ->> 'source' <> 'towing_pickup'
      or discovery_locality is null
      or discovery_country_code !~ '^[A-Z]{2}$'
      or discovery_lat is null
      or discovery_lng is null
      or discovery_lat = 'NaN'::double precision
      or discovery_lng = 'NaN'::double precision
      or discovery_lat not between -90 and 90
      or discovery_lng not between -180 and 180
      or nullif(btrim(p_update ->> 'city'), '') is distinct from discovery_locality
      or discovery_lat is distinct from next_pickup_lat
      or discovery_lng is distinct from next_pickup_lng
    then
      raise exception using errcode = '22023', message = 'Invalid pickup discovery location.';
    end if;

    insert into public.repair_request_discovery_locations (
      request_id, location, locality, postal_code, country_code, source,
      geocoded_at, updated_at
    ) values (
      p_request_id,
      extensions.ST_SetSRID(
        extensions.ST_MakePoint(discovery_lng, discovery_lat),
        4326
      )::extensions.geography,
      discovery_locality,
      discovery_postal_code,
      discovery_country_code,
      'towing_pickup',
      now(),
      now()
    )
    on conflict (request_id) do update set
      location = excluded.location,
      locality = excluded.locality,
      postal_code = excluded.postal_code,
      country_code = excluded.country_code,
      source = excluded.source,
      geocoded_at = excluded.geocoded_at,
      updated_at = excluded.updated_at;
  end if;

  return p_request_id;
end;
$function$;

revoke all on function public.update_towing_repair_request_with_discovery_location(uuid, jsonb, jsonb)
  from public, anon;
grant execute on function public.update_towing_repair_request_with_discovery_location(uuid, jsonb, jsonb)
  to authenticated;

create or replace function public.require_repair_request_discovery_location()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(new.request_type, 'repair') <> 'direct_message'
    and not exists (
      select 1
      from public.repair_request_discovery_locations discovery
      where discovery.request_id = new.id
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Repair request discovery location is required.';
  end if;

  return null;
end;
$function$;

revoke all on function public.require_repair_request_discovery_location()
  from public, anon, authenticated;

drop trigger if exists require_repair_request_discovery_location_trigger
  on public.repair_requests;

create constraint trigger require_repair_request_discovery_location_trigger
after insert on public.repair_requests
deferrable initially deferred
for each row
execute function public.require_repair_request_discovery_location();
