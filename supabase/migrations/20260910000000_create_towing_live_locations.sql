create table public.towing_live_locations (
  request_id uuid primary key
    references public.repair_requests(id) on delete cascade,
  appointment_id uuid not null
    references public.repair_appointments(id) on delete cascade,
  workshop_id uuid not null
    references public.profiles(id) on delete cascade,
  latitude double precision null,
  longitude double precision null,
  accuracy_meters double precision null,
  heading_degrees double precision null,
  speed_mps double precision null,
  phase text not null default 'to_pickup',
  is_active boolean not null default false,
  position_updated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint towing_live_locations_latitude_check
    check (latitude is null or latitude between -90 and 90),
  constraint towing_live_locations_longitude_check
    check (longitude is null or longitude between -180 and 180),
  constraint towing_live_locations_accuracy_check
    check (
      accuracy_meters is null
      or (
        accuracy_meters >= 0
        and accuracy_meters < 'Infinity'::double precision
      )
    ),
  constraint towing_live_locations_heading_check
    check (
      heading_degrees is null
      or (heading_degrees >= 0 and heading_degrees < 360)
    ),
  constraint towing_live_locations_speed_check
    check (
      speed_mps is null
      or (speed_mps >= 0 and speed_mps < 'Infinity'::double precision)
    ),
  constraint towing_live_locations_phase_check
    check (phase = 'to_pickup'),
  constraint towing_live_locations_active_position_check
    check (not is_active or (latitude is not null and longitude is not null))
);

create index towing_live_locations_active_workshop_idx
  on public.towing_live_locations (workshop_id)
  where is_active = true;

alter table public.towing_live_locations enable row level security;

create policy "Tracking participants can view live location"
on public.towing_live_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.repair_requests request
    left join public.repair_offers accepted_offer
      on accepted_offer.id = request.accepted_offer_id
    where request.id = towing_live_locations.request_id
      and (
        request.user_id = auth.uid()
        or (
          accepted_offer.request_id = request.id
          and accepted_offer.status = 'accepted'
          and accepted_offer.workshop_user_id = auth.uid()
        )
      )
  )
);

create policy "Winning workshop can insert live location"
on public.towing_live_locations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.repair_requests request
    join public.repair_offers accepted_offer
      on accepted_offer.id = request.accepted_offer_id
      and accepted_offer.request_id = request.id
      and accepted_offer.status = 'accepted'
    join public.repair_appointments appointment
      on appointment.id = towing_live_locations.appointment_id
      and appointment.request_id = request.id
      and appointment.offer_id = request.accepted_offer_id
      and appointment.workshop_id = accepted_offer.workshop_user_id
      and appointment.status = 'confirmed'
    where request.id = towing_live_locations.request_id
      and request.service_type = 'towing'
      and accepted_offer.workshop_user_id = auth.uid()
      and towing_live_locations.workshop_id = accepted_offer.workshop_user_id
  )
);

create policy "Winning workshop can update live location"
on public.towing_live_locations
for update
to authenticated
using (
  exists (
    select 1
    from public.repair_requests request
    join public.repair_offers accepted_offer
      on accepted_offer.id = request.accepted_offer_id
      and accepted_offer.request_id = request.id
      and accepted_offer.status = 'accepted'
    where request.id = towing_live_locations.request_id
      and request.service_type = 'towing'
      and accepted_offer.workshop_user_id = auth.uid()
      and towing_live_locations.workshop_id = accepted_offer.workshop_user_id
  )
)
with check (
  exists (
    select 1
    from public.repair_requests request
    join public.repair_offers accepted_offer
      on accepted_offer.id = request.accepted_offer_id
      and accepted_offer.request_id = request.id
      and accepted_offer.status = 'accepted'
    join public.repair_appointments appointment
      on appointment.id = towing_live_locations.appointment_id
      and appointment.request_id = request.id
      and appointment.offer_id = request.accepted_offer_id
      and appointment.workshop_id = accepted_offer.workshop_user_id
      and appointment.status = 'confirmed'
    where request.id = towing_live_locations.request_id
      and request.service_type = 'towing'
      and accepted_offer.workshop_user_id = auth.uid()
      and towing_live_locations.workshop_id = accepted_offer.workshop_user_id
  )
);

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
    updated_at = now()
  where request_id = p_request_id
    and workshop_id = v_workshop_id;
end;
$function$;

revoke all on table public.towing_live_locations
  from public, anon, authenticated;
grant select on table public.towing_live_locations to authenticated;

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

revoke all on function public.stop_towing_live_tracking(uuid)
  from public, anon;
grant execute on function public.stop_towing_live_tracking(uuid)
  to authenticated;

do $block$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'towing_live_locations'
  ) then
    alter publication supabase_realtime
      add table public.towing_live_locations;
  end if;
end;
$block$;
