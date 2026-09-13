create or replace function public.create_appointment_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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
