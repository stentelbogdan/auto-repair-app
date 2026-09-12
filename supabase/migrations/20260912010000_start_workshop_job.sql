create or replace function public.start_workshop_job(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.repair_requests%rowtype;
  v_accepted_offer public.repair_offers%rowtype;
  v_appointment_valid boolean;
  v_updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Autentificarea este obligatorie.';
  end if;

  select request.*
  into v_request
  from public.repair_requests request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'Lucrarea nu a fost găsită.';
  end if;

  if v_request.status is distinct from 'matched' then
    raise exception 'Lucrarea nu mai poate fi pornită din starea curentă.';
  end if;

  if v_request.accepted_offer_id is null then
    raise exception 'Oferta acceptată nu a fost găsită.';
  end if;

  select offer.*
  into v_accepted_offer
  from public.repair_offers offer
  where offer.id = v_request.accepted_offer_id
    and offer.request_id = v_request.id
    and offer.status = 'accepted';

  if v_accepted_offer.id is null then
    raise exception 'Oferta acceptată nu este validă pentru această lucrare.';
  end if;

  if v_accepted_offer.workshop_user_id is distinct from auth.uid() then
    raise exception 'Doar service-ul câștigător poate începe lucrarea.';
  end if;

  select true
  into v_appointment_valid
  from public.repair_appointments appointment
  where appointment.request_id = v_request.id
    and appointment.offer_id = v_accepted_offer.id
    and appointment.workshop_id = v_accepted_offer.workshop_user_id
    and appointment.status = 'confirmed'
  limit 1
  for share;

  if v_appointment_valid is not true then
    raise exception 'Programarea confirmată pentru oferta acceptată nu a fost găsită.';
  end if;

  update public.repair_requests
  set status = 'in_progress'
  where id = v_request.id
    and status = 'matched';

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 1 then
    raise exception 'Lucrarea nu a putut fi pornită deoarece starea ei s-a schimbat.';
  end if;
end;
$function$;

revoke all on function public.start_workshop_job(uuid) from public, anon;
grant execute on function public.start_workshop_job(uuid) to authenticated;
