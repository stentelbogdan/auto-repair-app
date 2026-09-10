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
  v_customer_id uuid;
  v_workshop_id uuid;
  v_losing_offer record;
begin
  select
    rr.user_id,
    ro.workshop_user_id
  into
    v_customer_id,
    v_workshop_id
  from public.repair_requests rr
  join public.repair_offers ro
    on ro.request_id = rr.id
  where rr.id = p_request_id
    and ro.id = p_offer_id;

  if v_customer_id is null or v_workshop_id is null then
    raise exception 'Cererea sau oferta nu a fost găsită.';
  end if;

  if auth.uid() is null
    or auth.uid() not in (v_customer_id, v_workshop_id)
  then
    raise exception 'Nu ai permisiunea să accepți această ofertă.';
  end if;

  for v_losing_offer in
    select
      ro.id as offer_id,
      ro.workshop_user_id,
      case
        when rr.service_type in ('bodywork', 'mechanical', 'wheels', 'towing')
          then rr.service_type
        else 'bodywork'
      end as category
    from public.repair_offers ro
    join public.repair_requests rr
      on rr.id = ro.request_id
    where ro.request_id = p_request_id
      and ro.id <> p_offer_id
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
    and request_id = p_request_id;

  update public.repair_requests
  set
    status = 'matched',
    accepted_offer_id = p_offer_id
  where id = p_request_id;
end;
$function$;
