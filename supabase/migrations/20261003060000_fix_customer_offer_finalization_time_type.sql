begin;

create or replace function public.finalize_customer_repair_offer(
  p_offer_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_customer_id uuid := auth.uid();
  locked_request public.repair_requests%rowtype;
  locked_offer public.repair_offers%rowtype;
  locked_appointment public.repair_appointments%rowtype;
  confirmed_date text;
  confirmed_time text;
begin
  if current_customer_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select *
  into locked_request
  from public.repair_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Repair request not found.';
  end if;

  if locked_request.user_id <> current_customer_id then
    raise exception 'Only the request owner can select the winning offer.'
      using errcode = '42501';
  end if;

  if locked_request.status <> 'open'
    or locked_request.accepted_offer_id is not null
  then
    raise exception 'The repair request no longer accepts offers.';
  end if;

  perform 1
  from public.repair_offers offer
  where offer.request_id = p_request_id
  order by offer.id
  for update;

  select *
  into locked_offer
  from public.repair_offers offer
  where offer.id = p_offer_id
    and offer.request_id = p_request_id;

  if not found or locked_offer.status <> 'pending' then
    raise exception 'The selected offer is not pending for this request.';
  end if;

  select *
  into locked_appointment
  from public.repair_appointments appointment
  where appointment.offer_id = p_offer_id
    and appointment.request_id = p_request_id
    and appointment.workshop_id = locked_offer.workshop_user_id
    and appointment.customer_id = current_customer_id
  for update;

  if not found then
    raise exception 'The appointment for the selected offer was not found.';
  end if;

  if locked_appointment.status not in ('requested', 'workshop_proposed') then
    raise exception 'This appointment cannot be finalized by the customer.';
  end if;

  confirmed_date := coalesce(
    locked_appointment.proposed_date,
    locked_appointment.appointment_date,
    locked_offer.available_date
  );
  confirmed_time := coalesce(
    locked_appointment.proposed_time,
    locked_appointment.appointment_time,
    locked_offer.available_time::text
  );

  if confirmed_date is null or confirmed_time is null then
    raise exception 'The appointment does not have a valid date and time.';
  end if;

  update public.repair_appointments appointment
  set
    status = 'confirmed',
    appointment_date = confirmed_date,
    appointment_time = confirmed_time,
    proposed_date = null,
    proposed_time = null,
    updated_at = now()
  where appointment.id = locked_appointment.id;

  perform public.complete_repair_offer_selection_locked(
    p_offer_id,
    p_request_id
  );
end;
$function$;

revoke all on function public.finalize_customer_repair_offer(uuid, uuid)
  from public, anon;
grant execute on function public.finalize_customer_repair_offer(uuid, uuid)
  to authenticated;

commit;
