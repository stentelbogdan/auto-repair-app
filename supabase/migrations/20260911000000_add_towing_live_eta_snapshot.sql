alter table public.towing_live_locations
  add column live_distance_to_pickup_meters double precision null,
  add column live_duration_to_pickup_seconds double precision null,
  add column live_eta_calculated_at timestamptz null,
  add column live_eta_origin_latitude double precision null,
  add column live_eta_origin_longitude double precision null;

alter table public.towing_live_locations
  add constraint towing_live_locations_eta_distance_check
  check (
    live_distance_to_pickup_meters is null
    or (
      live_distance_to_pickup_meters >= 0
      and live_distance_to_pickup_meters < 'Infinity'::double precision
    )
  ),
  add constraint towing_live_locations_eta_duration_check
  check (
    live_duration_to_pickup_seconds is null
    or (
      live_duration_to_pickup_seconds >= 0
      and live_duration_to_pickup_seconds < 'Infinity'::double precision
    )
  ),
  add constraint towing_live_locations_eta_origin_latitude_check
  check (
    live_eta_origin_latitude is null
    or live_eta_origin_latitude between -90 and 90
  ),
  add constraint towing_live_locations_eta_origin_longitude_check
  check (
    live_eta_origin_longitude is null
    or live_eta_origin_longitude between -180 and 180
  ),
  add constraint towing_live_locations_eta_snapshot_consistency_check
  check (
    (
      live_distance_to_pickup_meters is null
      and live_duration_to_pickup_seconds is null
      and live_eta_calculated_at is null
      and live_eta_origin_latitude is null
      and live_eta_origin_longitude is null
    )
    or (
      live_distance_to_pickup_meters is not null
      and live_duration_to_pickup_seconds is not null
      and live_eta_calculated_at is not null
      and live_eta_origin_latitude is not null
      and live_eta_origin_longitude is not null
    )
  );

create or replace function public.update_towing_live_eta(
  p_request_id uuid,
  p_distance_to_pickup_meters double precision,
  p_duration_to_pickup_seconds double precision,
  p_origin_latitude double precision,
  p_origin_longitude double precision
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_accepted_offer_id uuid;
  v_workshop_id uuid;
  v_latest_progress_status text;
  v_live_row_valid boolean;
begin
  if auth.uid() is null then
    raise exception 'Autentificarea este obligatorie.';
  end if;

  if p_distance_to_pickup_meters is null
    or p_distance_to_pickup_meters < 0
    or p_distance_to_pickup_meters >= 'Infinity'::double precision
  then
    raise exception 'Distanța până la preluare este invalidă.';
  end if;

  if p_duration_to_pickup_seconds is null
    or p_duration_to_pickup_seconds < 0
    or p_duration_to_pickup_seconds >= 'Infinity'::double precision
  then
    raise exception 'Durata până la preluare este invalidă.';
  end if;

  if p_origin_latitude is null or p_origin_latitude not between -90 and 90 then
    raise exception 'Latitudinea de origine ETA este invalidă.';
  end if;

  if p_origin_longitude is null
    or p_origin_longitude not between -180 and 180
  then
    raise exception 'Longitudinea de origine ETA este invalidă.';
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
    raise exception 'Doar service-ul câștigător poate actualiza ETA.';
  end if;

  select progress.status
  into v_latest_progress_status
  from public.work_progress_updates progress
  where progress.request_id = p_request_id
  order by progress.created_at desc
  limit 1;

  if v_latest_progress_status is distinct from 'Dispatch' then
    raise exception 'ETA live poate fi actualizat doar în etapa Dispatch.';
  end if;

  select true
  into v_live_row_valid
  from public.towing_live_locations live_location
  join public.repair_appointments appointment
    on appointment.id = live_location.appointment_id
    and appointment.request_id = p_request_id
    and appointment.offer_id = v_accepted_offer_id
    and appointment.workshop_id = v_workshop_id
    and appointment.status = 'confirmed'
  where live_location.request_id = p_request_id
    and live_location.workshop_id = v_workshop_id
    and live_location.phase = 'to_pickup'
    and live_location.is_active = true
  for update of live_location;

  if v_live_row_valid is not true then
    raise exception 'Trackingul live activ nu a fost găsit.';
  end if;

  update public.towing_live_locations
  set
    live_distance_to_pickup_meters = p_distance_to_pickup_meters,
    live_duration_to_pickup_seconds = p_duration_to_pickup_seconds,
    live_eta_calculated_at = now(),
    live_eta_origin_latitude = p_origin_latitude,
    live_eta_origin_longitude = p_origin_longitude,
    updated_at = now()
  where request_id = p_request_id
    and workshop_id = v_workshop_id
    and phase = 'to_pickup'
    and is_active = true;
end;
$function$;

create or replace function public.stop_towing_live_tracking(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_workshop_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Autentificarea este obligatorie.';
  end if;

  select accepted_offer.workshop_user_id
  into v_workshop_id
  from public.repair_requests request
  join public.repair_offers accepted_offer
    on accepted_offer.id = request.accepted_offer_id
    and accepted_offer.request_id = request.id
    and accepted_offer.status = 'accepted'
  where request.id = p_request_id
    and request.service_type = 'towing'
  for update of request;

  if v_workshop_id is null then
    raise exception 'Cererea Towing sau oferta acceptată nu a fost găsită.';
  end if;

  if auth.uid() <> v_workshop_id then
    raise exception 'Doar service-ul câștigător poate opri trackingul.';
  end if;

  update public.towing_live_locations
  set
    is_active = false,
    latitude = null,
    longitude = null,
    accuracy_meters = null,
    heading_degrees = null,
    speed_mps = null,
    live_distance_to_pickup_meters = null,
    live_duration_to_pickup_seconds = null,
    live_eta_calculated_at = null,
    live_eta_origin_latitude = null,
    live_eta_origin_longitude = null,
    updated_at = now()
  where request_id = p_request_id
    and workshop_id = v_workshop_id;
end;
$function$;

revoke all on function public.update_towing_live_eta(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision
) from public, anon;
grant execute on function public.update_towing_live_eta(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision
) to authenticated;
