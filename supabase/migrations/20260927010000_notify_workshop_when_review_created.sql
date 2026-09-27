begin;

create unique index notifications_customer_review_submitted_unique
on public.notifications (recipient_id, request_id, type)
where type = 'customer_review_submitted';

create function public.notify_workshop_when_review_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  request_record public.repair_requests%rowtype;
  accepted_offer public.repair_offers%rowtype;
  target_url text;
begin
  if current_user_id is null then
    raise exception 'Authenticated customer required'
      using errcode = '42501';
  end if;

  if current_user_id is distinct from new.customer_user_id then
    raise exception 'Review actor is not authorized'
      using errcode = '42501';
  end if;

  select request.*
  into request_record
  from public.repair_requests as request
  where request.id = new.request_id;

  if not found then
    raise exception 'Review request relationship is invalid'
      using errcode = '23514';
  end if;

  if request_record.user_id is distinct from new.customer_user_id then
    raise exception 'Review customer relationship is invalid'
      using errcode = '23514';
  end if;

  if request_record.status is distinct from 'completed' then
    raise exception 'Review request is not completed'
      using errcode = '23514';
  end if;

  if request_record.accepted_offer_id is null then
    raise exception 'Review accepted offer relationship is invalid'
      using errcode = '23514';
  end if;

  select offer.*
  into accepted_offer
  from public.repair_offers as offer
  where offer.id = request_record.accepted_offer_id
    and offer.request_id = request_record.id;

  if not found then
    raise exception 'Review accepted offer relationship is invalid'
      using errcode = '23514';
  end if;

  if accepted_offer.workshop_user_id is null then
    raise exception 'Review workshop relationship is invalid'
      using errcode = '23514';
  end if;

  if new.offer_id is distinct from request_record.accepted_offer_id then
    raise exception 'Review offer relationship is invalid'
      using errcode = '23514';
  end if;

  if new.workshop_user_id is distinct from accepted_offer.workshop_user_id then
    raise exception 'Review workshop relationship is invalid'
      using errcode = '23514';
  end if;

  target_url := case request_record.service_type
    when 'bodywork' then '/workshops/won-jobs?tab=completed&category=bodywork'
    when 'mechanical' then '/workshops/won-jobs?tab=completed&category=mechanical'
    when 'wheels' then '/workshops/won-jobs?tab=completed&category=wheels'
    when 'towing' then '/workshops/won-jobs?tab=completed&category=towing'
    else '/workshops/won-jobs?tab=completed'
  end;

  insert into public.notifications (
    recipient_id,
    recipient_role,
    actor_id,
    request_id,
    offer_id,
    type,
    title,
    message,
    target_url,
    read_at
  )
  values (
    accepted_offer.workshop_user_id,
    'workshop',
    request_record.user_id,
    new.request_id,
    request_record.accepted_offer_id,
    'customer_review_submitted',
    'Review nou',
    'Un client a publicat un review pentru o lucrare finalizată.',
    target_url,
    null
  )
  on conflict (recipient_id, request_id, type)
  where type = 'customer_review_submitted'
  do nothing;

  return new;
end;
$function$;

revoke all on function public.notify_workshop_when_review_created()
from public, anon, authenticated, service_role;

grant execute on function public.notify_workshop_when_review_created()
to service_role;

create trigger notify_workshop_when_review_created
after insert on public.reviews
for each row
execute function public.notify_workshop_when_review_created();

commit;
