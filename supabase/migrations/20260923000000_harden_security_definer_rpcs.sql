begin;

create or replace function public.can_workshop_update_request_status(
  request_id_input uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.repair_requests rr
    join public.repair_offers ro
      on ro.id = rr.accepted_offer_id
    where rr.id = request_id_input
      and ro.workshop_user_id = auth.uid()
  );
$function$;

revoke all on function public.can_workshop_update_request_status(uuid)
from public, anon, authenticated;
grant execute on function public.can_workshop_update_request_status(uuid)
to authenticated, service_role;

create or replace function public.create_appointment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_recipient_id uuid;
  v_recipient_role text;
  v_actor_id uuid;
  v_type text;
  v_title text;
  v_message text;
  v_target_url text;
  v_category text;
  v_should_notify boolean := false;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  /*
    Propunerile trebuie procesate și când statusul rămâne identic,
    dar se schimbă data sau ora.
  */
  if
    new.status is not distinct from old.status
    and new.proposed_date is not distinct from old.proposed_date
    and new.proposed_time is not distinct from old.proposed_time
  then
    return new;
  end if;

  if new.status = 'customer_proposed' then
    v_recipient_id := new.workshop_id;
    v_recipient_role := 'workshop';
    v_actor_id := new.customer_id;
    v_type := 'customer_proposed_appointment';
    v_title := 'Clientul a propus altă dată';
    v_message := 'Clientul a trimis o nouă propunere de programare.';
    v_target_url := '/workshops/my-offers';
    v_should_notify := true;

  elsif new.status = 'workshop_proposed' then
    v_recipient_id := new.customer_id;
    v_recipient_role := 'customer';
    v_actor_id := new.workshop_id;
    v_type := 'workshop_proposed_appointment';
    v_title := 'Service-ul a propus altă dată';
    v_message := 'Service-ul a trimis o nouă propunere de programare.';
    v_target_url := '/offers';
    v_should_notify := true;

  elsif new.status = 'confirmed'
    and old.status is distinct from 'confirmed'
  then
    if old.status = 'customer_proposed' then
      v_recipient_id := new.customer_id;
      v_recipient_role := 'customer';
      v_actor_id := new.workshop_id;
      v_type := 'workshop_confirmed_appointment';
      v_title := 'Programare confirmată';
      v_message := 'Service-ul a confirmat programarea propusă de tine.';

      select case request.service_type
        when 'bodywork' then 'bodywork'
        when 'mechanical' then 'mechanical'
        when 'wheels' then 'wheels'
        when 'towing' then 'towing'
        else 'bodywork'
      end
      into v_category
      from public.repair_requests as request
      where request.id = new.request_id;

      v_target_url :=
        '/customer/my-jobs?tab=scheduled&category=' ||
        coalesce(v_category, 'bodywork') ||
        '&focusRequest=' || new.request_id;

    else
      v_recipient_id := new.workshop_id;
      v_recipient_role := 'workshop';
      v_actor_id := new.customer_id;
      v_type := 'customer_confirmed_appointment';
      v_title := 'Programare confirmată';
      v_message := 'Clientul a confirmat programarea.';
      v_target_url := '/workshops/won-jobs?tab=appointments';
    end if;

    v_should_notify := true;
  end if;

  if
    v_should_notify
    and v_recipient_id is not null
    and v_recipient_role is not null
    and v_recipient_id is distinct from v_actor_id
  then
    insert into public.notifications (
      recipient_id,
      recipient_role,
      actor_id,
      request_id,
      offer_id,
      appointment_id,
      type,
      title,
      message,
      target_url
    )
    values (
      v_recipient_id,
      v_recipient_role,
      v_actor_id,
      new.request_id,
      new.offer_id,
      new.id,
      v_type,
      v_title,
      v_message,
      v_target_url
    );
  end if;

  return new;
end;
$function$;

revoke all on function public.create_appointment_notification()
from public, anon, authenticated;
grant execute on function public.create_appointment_notification()
to service_role;

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
to anon, authenticated, service_role;

create or replace function public.get_unread_messages_count()
returns integer
language sql
security definer
set search_path = ''
as $function$
  select count(distinct m.request_id)::integer
  from public.messages m
  left join public.conversation_reads cr
    on cr.request_id = m.request_id
   and cr.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.sender_role <> 'system'
    and m.created_at > coalesce(cr.last_read_at, '1970-01-01'::timestamptz)
    and (
      exists (
        select 1
        from public.repair_requests rr
        where rr.id = m.request_id
          and rr.user_id = auth.uid()
      )
      or exists (
        select 1
        from public.repair_offers ro
        where ro.request_id = m.request_id
          and ro.workshop_user_id = auth.uid()
      )
    );
$function$;

revoke all on function public.get_unread_messages_count()
from public, anon, authenticated;
grant execute on function public.get_unread_messages_count()
to authenticated, service_role;

create or replace function public.get_unread_progress_updates_by_request()
returns table (
  request_id uuid,
  unread_count integer
)
language sql
security definer
set search_path = ''
as $function$
  select wpu.request_id, count(*)::integer
  from public.work_progress_updates wpu
  join public.repair_requests rr on rr.id = wpu.request_id
  where rr.user_id = auth.uid()
    and not exists (
      select 1
      from public.work_progress_reads wpr
      where wpr.update_id = wpu.id
        and wpr.user_id = auth.uid()
    )
  group by wpu.request_id;
$function$;

revoke all on function public.get_unread_progress_updates_by_request()
from public, anon, authenticated;
grant execute on function public.get_unread_progress_updates_by_request()
to authenticated, service_role;

create or replace function public.get_unread_progress_updates_count()
returns integer
language sql
security definer
set search_path = ''
as $function$
  select count(*)::integer
  from public.work_progress_updates wpu
  join public.repair_requests rr on rr.id = wpu.request_id
  where rr.user_id = auth.uid()
    and not exists (
      select 1
      from public.work_progress_reads wpr
      where wpr.update_id = wpu.id
        and wpr.user_id = auth.uid()
    );
$function$;

revoke all on function public.get_unread_progress_updates_count()
from public, anon, authenticated;
grant execute on function public.get_unread_progress_updates_count()
to authenticated, service_role;

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
      when ra.status = 'confirmed'
        then ra.appointment_time
      else coalesce(ra.proposed_time, ra.appointment_time)
    end as slot_time
  from public.repair_appointments ra
  where ra.workshop_id = p_workshop_id
    and ra.status in (
      'requested',
      'customer_proposed',
      'workshop_proposed',
      'confirmed'
    )
    and (
      p_exclude_appointment_id is null
      or ra.id <> p_exclude_appointment_id
    )
    and (
      case
        when ra.status = 'confirmed'
          then ra.appointment_date
        else coalesce(ra.proposed_date, ra.appointment_date)
      end
    ) = p_date
    and (
      case
        when ra.status = 'confirmed'
          then ra.appointment_time
        else coalesce(ra.proposed_time, ra.appointment_time)
      end
    ) is not null
  order by slot_time;
$function$;

revoke all on function public.get_workshop_booked_slots(uuid, date, uuid)
from public, anon, authenticated;
grant execute on function public.get_workshop_booked_slots(uuid, date, uuid)
to authenticated, service_role;

commit;
