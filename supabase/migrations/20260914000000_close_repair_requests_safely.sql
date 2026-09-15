create or replace function public.close_repair_request(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.repair_requests%rowtype;
  v_pending_offer record;
begin
  if auth.uid() is null then
    raise exception 'Trebuie să fii autentificat pentru a închide cererea.';
  end if;

  select *
  into v_request
  from public.repair_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Cererea nu a fost găsită.';
  end if;

  if v_request.user_id <> auth.uid() then
    raise exception 'Nu ai permisiunea să închizi această cerere.';
  end if;

  if v_request.status <> 'open' then
    raise exception 'Cererea nu mai poate fi închisă în starea curentă.';
  end if;

  if v_request.accepted_offer_id is not null then
    raise exception 'Cererea are deja o ofertă acceptată și nu mai poate fi închisă.';
  end if;

  perform 1
  from public.repair_offers offer
  where offer.request_id = p_request_id
    and offer.status = 'pending'
  order by offer.id
  for update;

  if exists (
    select 1
    from public.repair_appointments appointment
    where appointment.request_id = p_request_id
      and appointment.status = 'confirmed'
      and exists (
        select 1
        from public.repair_offers offer
        where offer.id = appointment.offer_id
          and offer.request_id = p_request_id
      )
  ) then
    raise exception 'Cererea are deja o programare confirmată și nu mai poate fi închisă.';
  end if;

  update public.repair_appointments appointment
  set
    status = 'cancelled',
    updated_at = now()
  where appointment.request_id = p_request_id
    and appointment.status in (
      'requested',
      'customer_proposed',
      'workshop_proposed'
    )
    and exists (
      select 1
      from public.repair_offers offer
      where offer.id = appointment.offer_id
        and offer.request_id = p_request_id
        and offer.status = 'pending'
    );

  for v_pending_offer in
    select
      offer.id as offer_id,
      offer.workshop_user_id,
      case
        when v_request.service_type in ('bodywork', 'mechanical', 'wheels', 'towing')
          then v_request.service_type
        else 'bodywork'
      end as category
    from public.repair_offers offer
    where offer.request_id = p_request_id
      and offer.status = 'pending'
    order by offer.id
  loop
    insert into public.notifications (
      recipient_id,
      recipient_role,
      actor_id,
      request_id,
      offer_id,
      type,
      title,
      message,
      target_url
    )
    select
      v_pending_offer.workshop_user_id,
      'workshop',
      auth.uid(),
      p_request_id,
      v_pending_offer.offer_id,
      'workshop_request_closed',
      'Cerere închisă',
      'Clientul a închis cererea.',
      '/workshops/my-offers?category=' || v_pending_offer.category ||
        '&focusOffer=' || v_pending_offer.offer_id
    where not exists (
      select 1
      from public.notifications notification
      where notification.type = 'workshop_request_closed'
        and notification.offer_id = v_pending_offer.offer_id
        and notification.recipient_id = v_pending_offer.workshop_user_id
    );
  end loop;

  update public.repair_offers
  set status = 'rejected'
  where request_id = p_request_id
    and status = 'pending';

  update public.repair_requests
  set status = 'closed'
  where id = p_request_id
    and status = 'open'
    and accepted_offer_id is null;

  if not found then
    raise exception 'Cererea nu a putut fi închisă.';
  end if;
end;
$function$;

revoke all on function public.close_repair_request(uuid) from public;
revoke all on function public.close_repair_request(uuid) from anon;
grant execute on function public.close_repair_request(uuid) to authenticated;

create or replace function public.prevent_closed_request_reactivation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.status = 'closed'
    and (
      new.status is distinct from 'closed'
      or new.accepted_offer_id is distinct from old.accepted_offer_id
    )
  then
    raise exception 'Cererea închisă nu mai poate fi reactivată.';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_closed_request_reactivation() from public;
revoke all on function public.prevent_closed_request_reactivation() from anon;
revoke all on function public.prevent_closed_request_reactivation() from authenticated;

create trigger prevent_closed_request_reactivation_trigger
before update of status, accepted_offer_id on public.repair_requests
for each row
execute function public.prevent_closed_request_reactivation();

create or replace function public.accept_repair_offer(
  p_offer_id uuid,
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.repair_requests%rowtype;
  v_workshop_id uuid;
  v_offer_status text;
  v_losing_offer record;
begin
  if auth.uid() is null then
    raise exception 'Trebuie să fii autentificat pentru a accepta oferta.';
  end if;

  select *
  into v_request
  from public.repair_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Cererea nu a fost găsită.';
  end if;

  if v_request.status <> 'open' then
    raise exception 'Cererea nu mai acceptă oferte.';
  end if;

  if v_request.accepted_offer_id is not null then
    raise exception 'Cererea are deja o ofertă acceptată.';
  end if;

  perform 1
  from public.repair_offers offer
  where offer.request_id = p_request_id
  order by offer.id
  for update;

  select
    offer.workshop_user_id,
    offer.status
  into
    v_workshop_id,
    v_offer_status
  from public.repair_offers offer
  where offer.id = p_offer_id
    and offer.request_id = p_request_id;

  if not found then
    raise exception 'Oferta nu a fost găsită pentru această cerere.';
  end if;

  if v_offer_status <> 'pending' then
    raise exception 'Oferta nu mai poate fi acceptată în starea curentă.';
  end if;

  if auth.uid() not in (v_request.user_id, v_workshop_id) then
    raise exception 'Nu ai permisiunea să accepți această ofertă.';
  end if;

  for v_losing_offer in
    select
      offer.id as offer_id,
      offer.workshop_user_id,
      case
        when v_request.service_type in ('bodywork', 'mechanical', 'wheels', 'towing')
          then v_request.service_type
        else 'bodywork'
      end as category
    from public.repair_offers offer
    where offer.request_id = p_request_id
      and offer.id <> p_offer_id
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
      v_losing_offer.workshop_user_id,
      'workshop',
      p_request_id,
      v_losing_offer.offer_id,
      'workshop_offer_rejected',
      'Ofertă refuzată',
      'Oferta ta nu a fost selectată. Clientul a ales un alt service.',
      '/workshops/my-offers?category=' || v_losing_offer.category ||
        '&focusOffer=' || v_losing_offer.offer_id
    where not exists (
      select 1
      from public.notifications notification
      where notification.type = 'workshop_offer_rejected'
        and notification.offer_id = v_losing_offer.offer_id
        and notification.recipient_id = v_losing_offer.workshop_user_id
    );
  end loop;

  update public.repair_offers
  set status = 'rejected'
  where request_id = p_request_id;

  update public.repair_offers
  set
    status = 'accepted',
    workshop_read_at = null
  where id = p_offer_id
    and request_id = p_request_id
    and status = 'rejected';

  if not found then
    raise exception 'Oferta nu a putut fi acceptată.';
  end if;

  update public.repair_requests
  set
    status = 'matched',
    accepted_offer_id = p_offer_id
  where id = p_request_id
    and status = 'open'
    and accepted_offer_id is null;

  if not found then
    raise exception 'Cererea nu a putut fi asociată ofertei.';
  end if;
end;
$function$;

revoke all on function public.accept_repair_offer(uuid, uuid) from public;
revoke all on function public.accept_repair_offer(uuid, uuid) from anon;
grant execute on function public.accept_repair_offer(uuid, uuid) to authenticated;

create or replace function public.prevent_offer_for_inactive_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_status text;
  v_accepted_offer_id uuid;
begin
  if tg_op = 'UPDATE' and new.status <> 'pending' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select
      request.status,
      request.accepted_offer_id
    into
      v_request_status,
      v_accepted_offer_id
    from public.repair_requests request
    where request.id = new.request_id
    for update;
  else
    begin
      select
        request.status,
        request.accepted_offer_id
      into
        v_request_status,
        v_accepted_offer_id
      from public.repair_requests request
      where request.id = new.request_id
      for update nowait;
    exception
      when lock_not_available then
        raise exception 'Cererea este actualizată. Reîncearcă operația.';
    end;
  end if;

  if not found then
    raise exception 'Cererea nu a fost găsită.';
  end if;

  if v_request_status <> 'open' or v_accepted_offer_id is not null then
    raise exception 'Cererea nu mai acceptă oferte.';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_offer_for_inactive_request() from public;
revoke all on function public.prevent_offer_for_inactive_request() from anon;
revoke all on function public.prevent_offer_for_inactive_request() from authenticated;

create trigger prevent_offer_for_inactive_request_trigger
before insert or update of status, request_id on public.repair_offers
for each row
execute function public.prevent_offer_for_inactive_request();

create or replace function public.prevent_appointment_for_inactive_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_status text;
begin
  if tg_op = 'UPDATE'
    and (
      new.status not in (
        'requested',
        'customer_proposed',
        'workshop_proposed',
        'confirmed'
      )
      or (
        new.status is not distinct from old.status
        and new.request_id is not distinct from old.request_id
      )
    )
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select request.status
    into v_request_status
    from public.repair_requests request
    where request.id = new.request_id
    for update;
  else
    begin
      select request.status
      into v_request_status
      from public.repair_requests request
      where request.id = new.request_id
      for update nowait;
    exception
      when lock_not_available then
        raise exception 'Cererea este actualizată. Reîncearcă operația.';
    end;
  end if;

  if not found then
    raise exception 'Cererea nu a fost găsită.';
  end if;

  if v_request_status <> 'open' then
    raise exception 'Programarea nu poate fi creată sau confirmată pentru această cerere.';
  end if;

  return new;
end;
$function$;

revoke all on function public.prevent_appointment_for_inactive_request() from public;
revoke all on function public.prevent_appointment_for_inactive_request() from anon;
revoke all on function public.prevent_appointment_for_inactive_request() from authenticated;

create trigger prevent_appointment_for_inactive_request_trigger
before insert or update of status, request_id on public.repair_appointments
for each row
execute function public.prevent_appointment_for_inactive_request();
