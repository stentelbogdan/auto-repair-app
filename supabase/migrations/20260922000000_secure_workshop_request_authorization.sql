begin;

create or replace function public.workshop_can_access_repair_request(
  p_request_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_workshop_id uuid := auth.uid();
  request_record record;
begin
  if current_workshop_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = current_workshop_id
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  ) then
    return false;
  end if;

  select
    request.request_type,
    request.target_workshop_id,
    coalesce(request.service_type, 'bodywork') as service_type
  into request_record
  from public.repair_requests request
  where request.id = p_request_id;

  if not found then
    return false;
  end if;

  if request_record.request_type = 'direct_request'
    and request_record.target_workshop_id = current_workshop_id
  then
    return true;
  end if;

  if exists (
    select 1
    from public.repair_offers offer
    where offer.request_id = p_request_id
      and offer.workshop_user_id = current_workshop_id
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.repair_appointments appointment
    where appointment.request_id = p_request_id
      and appointment.workshop_id = current_workshop_id
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.workshop_discovery_eligible_requests(
      request_record.service_type,
      'default',
      null
    ) eligible
    where eligible.request_id = p_request_id
  );
end;
$function$;

revoke all on function public.workshop_can_access_repair_request(uuid)
from public, anon, authenticated;

create or replace function public.workshop_can_create_repair_offer(
  p_request_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_workshop_id uuid := auth.uid();
  request_record record;
begin
  if current_workshop_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = current_workshop_id
      and coalesce(to_jsonb(profile.role), '[]'::jsonb)
        @> '["workshop"]'::jsonb
  ) then
    return false;
  end if;

  select
    request.status,
    request.accepted_offer_id,
    request.request_type,
    request.target_workshop_id,
    coalesce(request.service_type, 'bodywork') as service_type
  into request_record
  from public.repair_requests request
  where request.id = p_request_id;

  if not found
    or request_record.status <> 'open'
    or request_record.accepted_offer_id is not null
  then
    return false;
  end if;

  if exists (
    select 1
    from public.repair_offers offer
    where offer.request_id = p_request_id
      and offer.workshop_user_id = current_workshop_id
  ) then
    return false;
  end if;

  if request_record.request_type = 'direct_request' then
    return request_record.target_workshop_id = current_workshop_id;
  end if;

  return exists (
    select 1
    from public.workshop_discovery_eligible_requests(
      request_record.service_type,
      'default',
      null
    ) eligible
    where eligible.request_id = p_request_id
  );
end;
$function$;

revoke all on function public.workshop_can_create_repair_offer(uuid)
from public, anon, authenticated;

create or replace function public.workshop_can_create_repair_appointment(
  p_request_id uuid,
  p_offer_id uuid,
  p_workshop_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and auth.uid() = p_workshop_id
    and exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and coalesce(to_jsonb(profile.role), '[]'::jsonb)
          @> '["workshop"]'::jsonb
    )
    and exists (
      select 1
      from public.repair_offers offer
      where offer.id = p_offer_id
        and offer.request_id = p_request_id
        and offer.workshop_user_id = auth.uid()
    );
$function$;

revoke all on function public.workshop_can_create_repair_appointment(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

create or replace function public.workshop_request_select_allowed(
  p_request_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.workshop_can_access_repair_request(p_request_id);
$function$;

revoke all on function public.workshop_request_select_allowed(uuid)
from public, anon;
grant execute on function public.workshop_request_select_allowed(uuid)
to authenticated;

create or replace function public.workshop_offer_insert_allowed(
  p_request_id uuid,
  p_workshop_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() = p_workshop_id
    and public.workshop_can_create_repair_offer(p_request_id);
$function$;

revoke all on function public.workshop_offer_insert_allowed(uuid, uuid)
from public, anon;
grant execute on function public.workshop_offer_insert_allowed(uuid, uuid)
to authenticated;

create or replace function public.workshop_appointment_insert_allowed(
  p_request_id uuid,
  p_offer_id uuid,
  p_workshop_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.workshop_can_create_repair_appointment(
    p_request_id,
    p_offer_id,
    p_workshop_id
  );
$function$;

revoke all on function public.workshop_appointment_insert_allowed(
  uuid,
  uuid,
  uuid
) from public, anon;
grant execute on function public.workshop_appointment_insert_allowed(
  uuid,
  uuid,
  uuid
) to authenticated;

create or replace function public.get_workshop_repair_request_detail(
  p_request_id uuid
)
returns table (
  request_data jsonb
)
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
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
    'description', request.description,
    'images', request.images,
    'status', request.status,
    'accepted_offer_id', request.accepted_offer_id,
    'created_at', request.created_at
  )
  from public.repair_requests request
  where request.id = p_request_id
    and public.workshop_can_access_repair_request(request.id);
$function$;

revoke all on function public.get_workshop_repair_request_detail(uuid)
from public, anon;
grant execute on function public.get_workshop_repair_request_detail(uuid)
to authenticated;

create or replace function public.get_public_workshop_review_request_context(
  p_workshop_id uuid
)
returns table (
  request_id uuid,
  car_year text,
  city text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct
    request.id as request_id,
    request.car_year::text,
    request.city::text
  from public.reviews review
  join public.repair_requests request
    on request.id = review.request_id
  where review.workshop_user_id = p_workshop_id;
$function$;

revoke all on function public.get_public_workshop_review_request_context(uuid)
from public, anon, authenticated;
grant execute on function public.get_public_workshop_review_request_context(uuid)
to anon, authenticated;

create or replace function public.record_repair_request_view(
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  inserted_rows integer;
  request_owner_id uuid;
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

  select request.user_id
  into request_owner_id
  from public.repair_requests request
  where request.id = p_request_id
    and request.status = 'open'
    and public.workshop_can_access_repair_request(request.id);

  if not found then
    raise exception 'Repair request is not available'
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

  if inserted_rows = 1 then
    insert into public.notifications (
      recipient_id,
      recipient_role,
      actor_id,
      request_id,
      type,
      title,
      message,
      read_at
    )
    values (
      request_owner_id,
      'customer',
      null,
      p_request_id,
      'customer_request_view_count_changed',
      'Actualizare vizualizări',
      'Contorul de vizualizări al cererii a fost actualizat.',
      now()
    );
  end if;

  return inserted_rows = 1;
end;
$function$;

revoke all on function public.record_repair_request_view(uuid)
from public, anon;
grant execute on function public.record_repair_request_view(uuid)
to authenticated;

create or replace function public.create_repair_offer_with_appointment(
  p_request_id uuid,
  p_price text,
  p_days text,
  p_message text,
  p_workshop_name text,
  p_available_date text,
  p_available_time text,
  p_handover_method text,
  p_pickup_address text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_workshop_id uuid := auth.uid();
  locked_request public.repair_requests%rowtype;
  offer_values public.repair_offers%rowtype;
  appointment_values public.repair_appointments%rowtype;
  created_offer_id uuid;
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

  select *
  into locked_request
  from public.repair_requests request
  where request.id = p_request_id
  for update;

  if not found
    or not public.workshop_can_create_repair_offer(p_request_id)
  then
    raise exception 'Repair request is not available for a new offer'
      using errcode = '42501';
  end if;

  offer_values := jsonb_populate_record(
    null::public.repair_offers,
    jsonb_build_object(
      'request_id', p_request_id,
      'workshop_user_id', current_workshop_id,
      'price', p_price,
      'days', p_days,
      'message', p_message,
      'workshop_name', p_workshop_name,
      'available_date', p_available_date,
      'available_time', p_available_time,
      'status', 'pending'
    )
  );

  insert into public.repair_offers (
    request_id,
    workshop_user_id,
    price,
    days,
    message,
    workshop_name,
    available_date,
    available_time,
    status
  )
  values (
    offer_values.request_id,
    offer_values.workshop_user_id,
    offer_values.price,
    offer_values.days,
    offer_values.message,
    offer_values.workshop_name,
    offer_values.available_date,
    offer_values.available_time,
    offer_values.status
  )
  returning id into created_offer_id;

  appointment_values := jsonb_populate_record(
    null::public.repair_appointments,
    jsonb_build_object(
      'request_id', p_request_id,
      'offer_id', created_offer_id,
      'customer_id', locked_request.user_id,
      'workshop_id', current_workshop_id,
      'appointment_date', p_available_date,
      'appointment_time', p_available_time,
      'original_date', p_available_date,
      'original_time', p_available_time,
      'proposed_date', p_available_date,
      'proposed_time', p_available_time,
      'handover_method',
        coalesce(nullif(btrim(p_handover_method), ''), 'customer_dropoff'),
      'pickup_address',
        case
          when p_handover_method = 'workshop_pickup'
            then nullif(btrim(p_pickup_address), '')
          else null
        end,
      'status', 'requested'
    )
  );

  insert into public.repair_appointments (
    request_id,
    offer_id,
    customer_id,
    workshop_id,
    appointment_date,
    appointment_time,
    original_date,
    original_time,
    proposed_date,
    proposed_time,
    handover_method,
    pickup_address,
    status
  )
  values (
    appointment_values.request_id,
    appointment_values.offer_id,
    appointment_values.customer_id,
    appointment_values.workshop_id,
    appointment_values.appointment_date,
    appointment_values.appointment_time,
    appointment_values.original_date,
    appointment_values.original_time,
    appointment_values.proposed_date,
    appointment_values.proposed_time,
    appointment_values.handover_method,
    appointment_values.pickup_address,
    appointment_values.status
  );

  return created_offer_id;
end;
$function$;

revoke all on function public.create_repair_offer_with_appointment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon;
grant execute on function public.create_repair_offer_with_appointment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

drop policy if exists "workshops can view all repair requests"
on public.repair_requests;

drop policy if exists "Anyone can read reviewed requests"
on public.repair_requests;

create policy "workshops can view authorized repair requests"
on public.repair_requests
for select
to authenticated
using (public.workshop_request_select_allowed(id));

drop policy if exists "workshops can insert own offers"
on public.repair_offers;

create policy "workshops can insert eligible own offers"
on public.repair_offers
for insert
to authenticated
with check (
  public.workshop_offer_insert_allowed(request_id, workshop_user_id)
);

drop policy if exists "workshops can only create appointments for own offers"
on public.repair_appointments;

create policy "workshops can only create appointments for own offers"
on public.repair_appointments
as restrictive
for insert
to authenticated
with check (
  public.workshop_appointment_insert_allowed(
    request_id,
    offer_id,
    workshop_id
  )
);

commit;
