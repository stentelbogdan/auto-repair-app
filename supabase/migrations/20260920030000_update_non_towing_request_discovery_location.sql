create or replace function public.update_repair_request_with_discovery_location(
  p_request_id uuid,
  p_update jsonb,
  p_discovery jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_user_id uuid := auth.uid();
  locked_request public.repair_requests%rowtype;
  locked_service_type text;
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
    or p_discovery is null
    or jsonb_typeof(p_update) <> 'object'
    or jsonb_typeof(p_discovery) <> 'object'
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

  locked_service_type := coalesce(
    nullif(btrim(locked_request.service_type), ''),
    'bodywork'
  );

  if coalesce(locked_request.request_type, 'repair') not in ('repair', 'direct_request')
    or locked_service_type not in ('bodywork', 'mechanical', 'wheels')
    or locked_service_type is distinct from nullif(btrim(p_update ->> 'service_type'), '')
    or locked_request.status <> 'open'
    or locked_request.accepted_offer_id is not null
    or exists (
      select 1
      from public.repair_offers
      where request_id = p_request_id
    )
  then
    raise exception using errcode = 'PT409', message = 'Cererea nu mai poate fi modificată.';
  end if;

  discovery_locality := nullif(btrim(p_discovery ->> 'locality'), '');
  discovery_postal_code := nullif(btrim(p_discovery ->> 'postal_code'), '');
  discovery_country_code := upper(nullif(btrim(p_discovery ->> 'country_code'), ''));

  begin
    discovery_lat := (p_discovery ->> 'lat')::double precision;
    discovery_lng := (p_discovery ->> 'lng')::double precision;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Invalid discovery coordinates.';
  end;

  if p_discovery ->> 'source' <> 'locality'
    or discovery_locality is null
    or discovery_country_code !~ '^[A-Z]{2}$'
    or discovery_lat is null
    or discovery_lng is null
    or discovery_lat in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or discovery_lng in ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
    or discovery_lat not between -90 and 90
    or discovery_lng not between -180 and 180
    or nullif(btrim(p_update ->> 'city'), '') is distinct from discovery_locality
  then
    raise exception using errcode = '22023', message = 'Invalid discovery location.';
  end if;

  if locked_service_type = 'wheels' then
    update public.repair_requests set
      city = discovery_locality,
      service_details = coalesce(p_update -> 'service_details', locked_request.service_details),
      description = p_update ->> 'description',
      images = coalesce(p_update -> 'images', '[]'::jsonb)
    where id = p_request_id;
  elsif locked_service_type = 'mechanical' then
    update public.repair_requests set
      city = discovery_locality,
      license_plate = nullif(p_update ->> 'license_plate', ''),
      damage_type = p_update ->> 'damage_type',
      service_details = p_update -> 'service_details',
      description = p_update ->> 'description',
      images = coalesce(p_update -> 'images', '[]'::jsonb)
    where id = p_request_id;
  else
    update public.repair_requests set
      city = discovery_locality,
      license_plate = nullif(p_update ->> 'license_plate', ''),
      service_details = p_update -> 'service_details',
      description = p_update ->> 'description',
      images = coalesce(p_update -> 'images', '[]'::jsonb)
    where id = p_request_id;
  end if;

  insert into public.repair_request_discovery_locations (
    request_id,
    location,
    locality,
    postal_code,
    country_code,
    source,
    geocoded_at,
    updated_at
  ) values (
    p_request_id,
    extensions.ST_SetSRID(
      extensions.ST_MakePoint(discovery_lng, discovery_lat),
      4326
    )::extensions.geography,
    discovery_locality,
    discovery_postal_code,
    discovery_country_code,
    'locality',
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

  return p_request_id;
end;
$function$;

revoke all on function public.update_repair_request_with_discovery_location(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_repair_request_with_discovery_location(uuid, jsonb, jsonb)
  to authenticated;
