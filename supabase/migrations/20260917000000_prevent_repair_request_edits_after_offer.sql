do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index_record
    where index_record.indrelid = 'public.repair_offers'::regclass
      and index_record.indisvalid
      and index_record.indisready
      and index_record.indislive
      and index_record.indpred is null
      and index_record.indnkeyatts >= 1
      and pg_catalog.pg_get_indexdef(
        index_record.indexrelid,
        1,
        true
      ) = 'request_id'
  ) then
    create index repair_offers_request_id_idx
      on public.repair_offers (request_id);
  end if;
end;
$block$;

create or replace function public.prevent_repair_request_edits_after_offer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    old.car_brand is distinct from new.car_brand
    or old.car_model is distinct from new.car_model
    or old.car_year is distinct from new.car_year
    or old.city is distinct from new.city
    or old.license_plate is distinct from new.license_plate
    or old.damage_type is distinct from new.damage_type
    or old.service_details is distinct from new.service_details
    or old.service_type is distinct from new.service_type
    or old.request_type is distinct from new.request_type
    or old.target_workshop_id is distinct from new.target_workshop_id
    or old.description is distinct from new.description
    or old.images is distinct from new.images
    or old.pickup_lat is distinct from new.pickup_lat
    or old.pickup_lng is distinct from new.pickup_lng
    or old.destination_lat is distinct from new.destination_lat
    or old.destination_lng is distinct from new.destination_lng
    or old.route_distance_meters is distinct from new.route_distance_meters
    or old.route_duration_seconds is distinct from new.route_duration_seconds
    or old.route_paths is distinct from new.route_paths
    or old.towing_schedule_type is distinct from new.towing_schedule_type
    or old.towing_requested_at is distinct from new.towing_requested_at
    or old.towing_requested_timezone is distinct from new.towing_requested_timezone
  ) then
    return new;
  end if;

  if old.status <> 'open'
    or old.accepted_offer_id is not null
    or new.status <> 'open'
    or new.accepted_offer_id is not null
  then
    raise exception using
      errcode = 'PT409',
      message = 'Cererea nu mai poate fi modificată.';
  end if;

  if exists (
    select 1
    from public.repair_offers offer
    where offer.request_id = old.id
  ) then
    raise exception using
      errcode = 'PT409',
      message = 'Cererea nu mai poate fi modificată deoarece a primit deja o ofertă.';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_repair_request_edits_after_offer()
  from public;
revoke all on function public.prevent_repair_request_edits_after_offer()
  from anon;
revoke all on function public.prevent_repair_request_edits_after_offer()
  from authenticated;

drop trigger if exists prevent_repair_request_edits_after_offer_trigger
  on public.repair_requests;

create trigger prevent_repair_request_edits_after_offer_trigger
before update of
  car_brand,
  car_model,
  car_year,
  city,
  license_plate,
  damage_type,
  service_details,
  service_type,
  request_type,
  target_workshop_id,
  description,
  images,
  pickup_lat,
  pickup_lng,
  destination_lat,
  destination_lng,
  route_distance_meters,
  route_duration_seconds,
  route_paths,
  towing_schedule_type,
  towing_requested_at,
  towing_requested_timezone
on public.repair_requests
for each row
execute function public.prevent_repair_request_edits_after_offer();
