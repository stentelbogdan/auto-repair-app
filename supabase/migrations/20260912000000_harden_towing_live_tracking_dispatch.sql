create or replace function public.upsert_towing_live_location(
  p_request_id uuid,
  p_appointment_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision default null,
  p_heading_degrees double precision default null,
  p_speed_mps double precision default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_accepted_offer_id uuid;
  v_workshop_id uuid;
  v_appointment_valid boolean;
  v_latest_progress_status text;
begin
  if auth.uid() is null then
    raise exception 'Autentificarea este obligatorie.';
  end if;

  if p_latitude is null or p_latitude not between -90 and 90 then
    raise exception 'Latitudinea este invalidă.';
  end if;

  if p_longitude is null or p_longitude not between -180 and 180 then
    raise exception 'Longitudinea este invalidă.';
  end if;

  if p_accuracy_meters is not null
    and (
      p_accuracy_meters < 0
      or p_accuracy_meters >= 'Infinity'::double precision
    )
  then
    raise exception 'Precizia este invalidă.';
  end if;

  if p_heading_degrees is not null
    and (p_heading_degrees < 0 or p_heading_degrees >= 360)
  then
    raise exception 'Direcția este invalidă.';
  end if;

  if p_speed_mps is not null
    and (p_speed_mps < 0 or p_speed_mps >= 'Infinity'::double precision)
  then
    raise exception 'Viteza este invalidă.';
  end if;

  select
    request.accepted_offer_id,
    accepted_offer.workshop_user_id
  into
    v_accepted_offer_id,
    v_workshop_id
  from public.repair_requests request
  join public.repair_offers accepted_offer
    on accepted_offer.id = request.accepted_offer_id
    and accepted_offer.request_id = request.id
    and accepted_offer.status = 'accepted'
  where request.id = p_request_id
    and request.service_type = 'towing'
  for update of request;

  if v_accepted_offer_id is null or v_workshop_id is null then
    raise exception 'Cererea Towing sau oferta acceptată nu a fost găsită.';
  end if;

  if auth.uid() <> v_workshop_id then
    raise exception 'Doar service-ul câștigător poate transmite locația.';
  end if;

  select true
  into v_appointment_valid
  from public.repair_appointments appointment
  where appointment.id = p_appointment_id
    and appointment.request_id = p_request_id
    and appointment.offer_id = v_accepted_offer_id
    and appointment.workshop_id = v_workshop_id
    and appointment.status = 'confirmed'
  for share;

  if v_appointment_valid is not true then
    raise exception 'Programarea confirmată nu a fost găsită.';
  end if;

  select progress.status
  into v_latest_progress_status
  from public.work_progress_updates progress
  where progress.request_id = p_request_id
  order by progress.created_at desc
  limit 1;

  if v_latest_progress_status is distinct from 'Dispatch' then
    raise exception 'Locația live poate fi transmisă doar în etapa Dispatch.';
  end if;

  insert into public.towing_live_locations (
    request_id,
    appointment_id,
    workshop_id,
    latitude,
    longitude,
    accuracy_meters,
    heading_degrees,
    speed_mps,
    phase,
    is_active,
    position_updated_at,
    updated_at
  )
  values (
    p_request_id,
    p_appointment_id,
    v_workshop_id,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_heading_degrees,
    p_speed_mps,
    'to_pickup',
    true,
    now(),
    now()
  )
  on conflict (request_id) do update
  set
    appointment_id = excluded.appointment_id,
    workshop_id = excluded.workshop_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_meters = excluded.accuracy_meters,
    heading_degrees = excluded.heading_degrees,
    speed_mps = excluded.speed_mps,
    phase = 'to_pickup',
    is_active = true,
    position_updated_at = now(),
    updated_at = now();
end;
$function$;

revoke all on function public.upsert_towing_live_location(
  uuid,
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision
) from public, anon;
grant execute on function public.upsert_towing_live_location(
  uuid,
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision
) to authenticated;
