begin;

do $block$
begin
  if exists (
    select 1
    from public.repair_appointments appointment
    where appointment.offer_id is not null
    group by appointment.offer_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Cannot enforce one appointment per offer while duplicate offer_id values exist.';
  end if;
end;
$block$;

create unique index repair_appointments_offer_id_unique_idx
  on public.repair_appointments (offer_id)
  where offer_id is not null;

create or replace function public.enforce_repair_appointment_insert_authority()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  request_owner_id uuid;
  request_status text;
  request_accepted_offer_id uuid;
  offer_request_id uuid;
  offer_workshop_id uuid;
  offer_status text;
begin
  if actor_id is null or actor_id is distinct from new.workshop_id then
    raise exception 'Only the offer workshop can create the initial appointment.'
      using errcode = '42501';
  end if;

  select
    request.user_id,
    request.status,
    request.accepted_offer_id
  into
    request_owner_id,
    request_status,
    request_accepted_offer_id
  from public.repair_requests request
  where request.id = new.request_id;

  if not found
    or request_status <> 'open'
    or request_accepted_offer_id is not null
    or new.customer_id is distinct from request_owner_id
  then
    raise exception 'The appointment does not match an open repair request.'
      using errcode = '42501';
  end if;

  select
    offer.request_id,
    offer.workshop_user_id,
    offer.status
  into
    offer_request_id,
    offer_workshop_id,
    offer_status
  from public.repair_offers offer
  where offer.id = new.offer_id;

  if not found
    or offer_request_id is distinct from new.request_id
    or offer_workshop_id is distinct from new.workshop_id
    or offer_status <> 'pending'
  then
    raise exception 'The appointment does not match a pending workshop offer.'
      using errcode = '42501';
  end if;

  if new.status is distinct from 'requested' then
    raise exception 'A workshop appointment must start in requested status.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_repair_appointment_insert_authority()
  from public, anon, authenticated, service_role;

create trigger enforce_repair_appointment_insert_authority_trigger
before insert on public.repair_appointments
for each row
execute function public.enforce_repair_appointment_insert_authority();

create or replace function public.protect_repair_appointment_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_owner_id uuid;
  offer_request_id uuid;
  offer_workshop_id uuid;
begin
  if new.request_id is distinct from old.request_id
    or new.offer_id is distinct from old.offer_id
    or new.customer_id is distinct from old.customer_id
    or new.workshop_id is distinct from old.workshop_id
  then
    raise exception 'Repair appointment identity cannot be changed.'
      using errcode = '42501';
  end if;

  select
    request.user_id,
    offer.request_id,
    offer.workshop_user_id
  into
    request_owner_id,
    offer_request_id,
    offer_workshop_id
  from public.repair_requests request
  join public.repair_offers offer
    on offer.id = new.offer_id
  where request.id = new.request_id;

  if not found
    or new.customer_id is distinct from request_owner_id
    or offer_request_id is distinct from new.request_id
    or offer_workshop_id is distinct from new.workshop_id
  then
    raise exception 'Repair appointment identity does not match its request and offer.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_repair_appointment_identity()
  from public, anon, authenticated, service_role;

create trigger protect_repair_appointment_identity_trigger
before update on public.repair_appointments
for each row
execute function public.protect_repair_appointment_identity();

create or replace function public.complete_repair_offer_selection_locked(
  p_offer_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_service_type text;
  losing_offer record;
begin
  select request.service_type
  into request_service_type
  from public.repair_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Repair request not found.';
  end if;

  for losing_offer in
    select offer.id as offer_id, offer.workshop_user_id
    from public.repair_offers offer
    where offer.request_id = p_request_id
      and offer.id <> p_offer_id
    order by offer.id
  loop
    insert into public.notifications (
      recipient_id,
      recipient_role,
      request_id,
      offer_id,
      type,
      title,
      message,
      target_url
    )
    select
      losing_offer.workshop_user_id,
      'workshop',
      p_request_id,
      losing_offer.offer_id,
      'workshop_offer_rejected',
      'Ofertă refuzată',
      'Oferta ta nu a fost selectată. Clientul a ales un alt service.',
      '/workshops/my-offers?category=' ||
        case
          when request_service_type in ('bodywork', 'mechanical', 'wheels', 'towing')
            then request_service_type
          else 'bodywork'
        end ||
        '&focusOffer=' || losing_offer.offer_id
    where not exists (
      select 1
      from public.notifications notification
      where notification.type = 'workshop_offer_rejected'
        and notification.offer_id = losing_offer.offer_id
        and notification.recipient_id = losing_offer.workshop_user_id
    );
  end loop;

  update public.repair_offers offer
  set status = 'rejected'
  where offer.request_id = p_request_id;

  update public.repair_offers offer
  set status = 'accepted', workshop_read_at = null
  where offer.id = p_offer_id
    and offer.request_id = p_request_id
    and offer.status = 'rejected';

  if not found then
    raise exception 'The selected offer could not be accepted.';
  end if;

  update public.repair_requests request
  set status = 'matched', accepted_offer_id = p_offer_id
  where request.id = p_request_id
    and request.status = 'open'
    and request.accepted_offer_id is null;

  if not found then
    raise exception 'The repair request could not be matched to the selected offer.';
  end if;
end;
$function$;

revoke all on function public.complete_repair_offer_selection_locked(uuid, uuid)
  from public, anon, authenticated;

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
    locked_offer.available_time
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

create or replace function public.finalize_workshop_customer_proposal(
  p_offer_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_workshop_id uuid := auth.uid();
  locked_request public.repair_requests%rowtype;
  locked_offer public.repair_offers%rowtype;
  locked_appointment public.repair_appointments%rowtype;
begin
  if current_workshop_id is null then
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

  if not found
    or locked_offer.status <> 'pending'
    or locked_offer.workshop_user_id <> current_workshop_id
  then
    raise exception 'The pending offer does not belong to this workshop.'
      using errcode = '42501';
  end if;

  select *
  into locked_appointment
  from public.repair_appointments appointment
  where appointment.offer_id = p_offer_id
    and appointment.request_id = p_request_id
    and appointment.workshop_id = current_workshop_id
    and appointment.customer_id = locked_request.user_id
  for update;

  if not found then
    raise exception 'The appointment for this offer was not found.';
  end if;

  if locked_appointment.status <> 'customer_proposed'
    or locked_appointment.proposed_date is null
    or locked_appointment.proposed_time is null
  then
    raise exception 'Only an exact customer proposal can be finalized by the workshop.'
      using errcode = '42501';
  end if;

  update public.repair_appointments appointment
  set
    status = 'confirmed',
    appointment_date = locked_appointment.proposed_date,
    appointment_time = locked_appointment.proposed_time,
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

revoke all on function public.finalize_workshop_customer_proposal(uuid, uuid)
  from public, anon;
grant execute on function public.finalize_workshop_customer_proposal(uuid, uuid)
  to authenticated;

create or replace function public.accept_repair_offer(
  p_offer_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.finalize_customer_repair_offer(p_offer_id, p_request_id);
end;
$function$;

revoke all on function public.accept_repair_offer(uuid, uuid)
  from public, anon;
grant execute on function public.accept_repair_offer(uuid, uuid)
  to authenticated;

create or replace function public.prevent_direct_preaward_appointment_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  request_status text;
  request_accepted_offer_id uuid;
begin
  if new.status is not distinct from 'confirmed'
    and old.status is distinct from 'confirmed'
    and current_user not in ('postgres', 'service_role')
  then
    select request.status, request.accepted_offer_id
    into request_status, request_accepted_offer_id
    from public.repair_requests request
    where request.id = new.request_id;

    if request_status = 'open' and request_accepted_offer_id is null then
      raise exception 'Pre-award appointment confirmation requires an atomic finalization RPC.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_direct_preaward_appointment_confirmation()
  from public, anon, authenticated, service_role;

create trigger prevent_direct_preaward_appointment_confirmation_trigger
before update of status on public.repair_appointments
for each row
execute function public.prevent_direct_preaward_appointment_confirmation();

create or replace function public.protect_preaward_appointment_proposal_authority()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  request_status text;
  request_accepted_offer_id uuid;
  actor_id uuid := auth.uid();
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  select request.status, request.accepted_offer_id
  into request_status, request_accepted_offer_id
  from public.repair_requests request
  where request.id = new.request_id;

  if request_status <> 'open' or request_accepted_offer_id is not null then
    return new;
  end if;

  if new.status = 'customer_proposed'
    and (
      actor_id is distinct from new.customer_id
      or (
        old.status = 'customer_proposed'
        and actor_id is distinct from old.customer_id
        and (
          old.proposed_date is distinct from new.proposed_date
          or old.proposed_time is distinct from new.proposed_time
        )
      )
    )
  then
    raise exception 'Only the customer can create or change a customer proposal.'
      using errcode = '42501';
  end if;

  if new.status = 'workshop_proposed'
    and (
      actor_id is distinct from new.workshop_id
      or (
        old.status = 'workshop_proposed'
        and actor_id is distinct from old.workshop_id
        and (
          old.proposed_date is distinct from new.proposed_date
          or old.proposed_time is distinct from new.proposed_time
        )
      )
    )
  then
    raise exception 'Only the workshop can create or change a workshop proposal.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_preaward_appointment_proposal_authority()
  from public, anon, authenticated, service_role;

create trigger protect_preaward_appointment_proposal_authority_trigger
before update of status, proposed_date, proposed_time
on public.repair_appointments
for each row
execute function public.protect_preaward_appointment_proposal_authority();

create or replace function public.prevent_direct_offer_selection_updates()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if old.status is distinct from new.status
    and new.status in ('accepted', 'rejected')
    and current_user not in ('postgres', 'service_role')
  then
    raise exception 'Offer selection must use an authorized finalization RPC.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_direct_offer_selection_updates()
  from public, anon, authenticated, service_role;

create trigger prevent_direct_offer_selection_updates_trigger
before update of status on public.repair_offers
for each row
execute function public.prevent_direct_offer_selection_updates();

create or replace function public.prevent_direct_request_winner_updates()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (
    old.accepted_offer_id is distinct from new.accepted_offer_id
    or (old.status is distinct from new.status and new.status = 'matched')
  ) and current_user not in ('postgres', 'service_role')
  then
    raise exception 'The winning offer must be selected through an authorized finalization RPC.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_direct_request_winner_updates()
  from public, anon, authenticated, service_role;

create trigger prevent_direct_request_winner_updates_trigger
before update of status, accepted_offer_id on public.repair_requests
for each row
execute function public.prevent_direct_request_winner_updates();

commit;
