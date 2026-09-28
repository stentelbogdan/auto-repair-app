begin;

create function public.workshop_appointment_lifecycle_blocks_slot(
  p_appointment_status text,
  p_request_status text,
  p_accepted_offer_id uuid,
  p_appointment_request_id uuid,
  p_appointment_offer_id uuid,
  p_appointment_workshop_id uuid,
  p_offer_status text,
  p_offer_request_id uuid,
  p_offer_workshop_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce((
    p_appointment_status in (
      'requested',
      'customer_proposed',
      'workshop_proposed',
      'confirmed'
    )
    and p_offer_request_id = p_appointment_request_id
    and p_offer_workshop_id = p_appointment_workshop_id
    and (
      (
        p_request_status = 'open'
        and p_accepted_offer_id is null
        and p_offer_status = 'pending'
      )
      or (
        p_request_status in ('matched', 'in_progress')
        and p_accepted_offer_id = p_appointment_offer_id
        and p_offer_status = 'accepted'
      )
    )
  ), false);
$function$;

revoke all on function public.workshop_appointment_lifecycle_blocks_slot(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

create or replace function public.get_workshop_booked_slots(
  p_workshop_id uuid,
  p_date date,
  p_exclude_appointment_id uuid default null::uuid
)
returns table (
  slot_time text
)
language sql
security definer
set search_path = ''
as $function$
  select distinct
    case
      when appointment.status = 'confirmed'
        then appointment.appointment_time
      else coalesce(
        appointment.proposed_time,
        appointment.appointment_time
      )
    end as slot_time
  from public.repair_appointments as appointment
  join public.repair_requests as request
    on request.id = appointment.request_id
  join public.repair_offers as offer
    on offer.id = appointment.offer_id
  where appointment.workshop_id = p_workshop_id
    and public.workshop_appointment_lifecycle_blocks_slot(
      appointment.status,
      request.status,
      request.accepted_offer_id,
      appointment.request_id,
      appointment.offer_id,
      appointment.workshop_id,
      offer.status,
      offer.request_id,
      offer.workshop_user_id
    )
    and (
      p_exclude_appointment_id is null
      or appointment.id <> p_exclude_appointment_id
    )
    and (
      case
        when appointment.status = 'confirmed'
          then appointment.appointment_date
        else coalesce(
          appointment.proposed_date,
          appointment.appointment_date
        )
      end
    ) = p_date
    and (
      case
        when appointment.status = 'confirmed'
          then appointment.appointment_time
        else coalesce(
          appointment.proposed_time,
          appointment.appointment_time
        )
      end
    ) is not null
  order by slot_time;
$function$;

revoke all on function public.get_workshop_booked_slots(uuid, date, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_workshop_booked_slots(uuid, date, uuid)
to authenticated, service_role;

create function public.prevent_workshop_appointment_slot_collision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  effective_date date;
  effective_time text;
  request_status text;
  accepted_offer_id uuid;
  offer_status text;
  offer_request_id uuid;
  offer_workshop_id uuid;
  slot_lock_key bigint;
begin
  effective_date := case
    when new.status = 'confirmed'
      then new.appointment_date
    else coalesce(new.proposed_date, new.appointment_date)
  end;

  effective_time := case
    when new.status = 'confirmed'
      then new.appointment_time
    else coalesce(new.proposed_time, new.appointment_time)
  end;

  if new.status not in (
    'requested',
    'customer_proposed',
    'workshop_proposed',
    'confirmed'
  ) or effective_date is null or effective_time is null then
    return new;
  end if;

  select
    request.status,
    request.accepted_offer_id,
    offer.status,
    offer.request_id,
    offer.workshop_user_id
  into
    request_status,
    accepted_offer_id,
    offer_status,
    offer_request_id,
    offer_workshop_id
  from public.repair_requests as request
  join public.repair_offers as offer
    on offer.id = new.offer_id
  where request.id = new.request_id;

  if not found or not public.workshop_appointment_lifecycle_blocks_slot(
    new.status,
    request_status,
    accepted_offer_id,
    new.request_id,
    new.offer_id,
    new.workshop_id,
    offer_status,
    offer_request_id,
    offer_workshop_id
  ) then
    return new;
  end if;

  slot_lock_key := pg_catalog.hashtextextended(
    new.workshop_id::text || '|' ||
      effective_date::text || '|' ||
      effective_time,
    0
  );

  perform pg_catalog.pg_advisory_xact_lock(slot_lock_key);

  if exists (
    select 1
    from public.repair_appointments as appointment
    join public.repair_requests as request
      on request.id = appointment.request_id
    join public.repair_offers as offer
      on offer.id = appointment.offer_id
    where appointment.id is distinct from new.id
      and appointment.workshop_id = new.workshop_id
      and public.workshop_appointment_lifecycle_blocks_slot(
        appointment.status,
        request.status,
        request.accepted_offer_id,
        appointment.request_id,
        appointment.offer_id,
        appointment.workshop_id,
        offer.status,
        offer.request_id,
        offer.workshop_user_id
      )
      and (
        case
          when appointment.status = 'confirmed'
            then appointment.appointment_date
          else coalesce(
            appointment.proposed_date,
            appointment.appointment_date
          )
        end
      ) = effective_date
      and (
        case
          when appointment.status = 'confirmed'
            then appointment.appointment_time
          else coalesce(
            appointment.proposed_time,
            appointment.appointment_time
          )
        end
      ) = effective_time
  ) then
    raise exception 'Appointment slot is no longer available'
      using errcode = 'PT409';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_workshop_appointment_slot_collision()
from public, anon, authenticated, service_role;

create trigger prevent_workshop_appointment_slot_collision_trigger
before insert or update of
  status,
  appointment_date,
  appointment_time,
  proposed_date,
  proposed_time,
  workshop_id,
  request_id,
  offer_id
on public.repair_appointments
for each row
execute function public.prevent_workshop_appointment_slot_collision();

commit;
