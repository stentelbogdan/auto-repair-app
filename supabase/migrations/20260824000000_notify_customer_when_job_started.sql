create or replace function public.notify_customer_when_job_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted_offer public.repair_offers%rowtype;
  confirmed_appointment_id uuid;
  workshop_display_name text;
  vehicle_name text;
begin
  if old.status is distinct from 'matched'
    or new.status is distinct from 'in_progress'
  then
    return new;
  end if;

  select offer.*
  into accepted_offer
  from public.repair_offers as offer
  where offer.id = new.accepted_offer_id
    and offer.request_id = new.id
    and offer.status = 'accepted';

  if accepted_offer.id is null then
    raise exception 'Accepted offer not found for started repair request';
  end if;

  select appointment.id
  into confirmed_appointment_id
  from public.repair_appointments as appointment
  where appointment.request_id = new.id
    and appointment.status = 'confirmed'
  order by appointment.updated_at desc nulls last
  limit 1;

  if confirmed_appointment_id is null then
    raise exception 'Confirmed appointment not found for started repair request';
  end if;

  workshop_display_name := coalesce(
    nullif(btrim(accepted_offer.workshop_name), ''),
    'Service'
  );
  vehicle_name := coalesce(
    nullif(btrim(concat_ws(' ', new.car_brand, new.car_model)), ''),
    'mașina ta'
  );

  insert into public.notifications (
    recipient_id,
    recipient_role,
    actor_id,
    type,
    request_id,
    offer_id,
    appointment_id,
    title,
    message,
    target_url
  )
  values (
    new.user_id,
    'customer',
    accepted_offer.workshop_user_id,
    'workshop_started_job',
    new.id,
    accepted_offer.id,
    confirmed_appointment_id,
    'Lucrarea a început',
    workshop_display_name || ' a început lucrarea pentru ' || vehicle_name || '.',
    '/customer/my-jobs?tab=in_progress'
  );

  return new;
end;
$$;

revoke all on function public.notify_customer_when_job_started() from public;
revoke all on function public.notify_customer_when_job_started() from anon;
revoke all on function public.notify_customer_when_job_started() from authenticated;

drop trigger if exists notify_customer_when_job_started
on public.repair_requests;

create trigger notify_customer_when_job_started
after update of status on public.repair_requests
for each row
execute function public.notify_customer_when_job_started();
