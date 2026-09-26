begin;

-- Keep the authorized legacy mapping and its relationship checks atomic.
lock table public.repair_requests, public.repair_offers, public.messages
  in share row exclusive mode;

create or replace function public.guard_client_request_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if auth.uid() is null
    or new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
  then
    raise exception using errcode = '42501', message = 'Request identity and ownership cannot be changed by clients.';
  end if;

  if old.user_id is distinct from auth.uid() then
    if (pg_catalog.to_jsonb(new) - array['status', 'target_workshop_read_at'])
      is distinct from (pg_catalog.to_jsonb(old) - array['status', 'target_workshop_read_at'])
    then
      raise exception using errcode = '42501', message = 'Workshops may only update request status or their direct-request receipt.';
    end if;

    if new.status is distinct from old.status
      and not public.can_workshop_update_request_status(old.id)
    then
      raise exception using errcode = '42501', message = 'Only the winning workshop may update request status.';
    end if;

    if new.target_workshop_read_at is distinct from old.target_workshop_read_at
      and old.target_workshop_id is distinct from auth.uid()
    then
      raise exception using errcode = '42501', message = 'Only the target workshop may update its receipt.';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_client_request_identity() from public, anon, authenticated;
grant execute on function public.guard_client_request_identity() to service_role;
drop trigger if exists guard_client_request_identity_trigger on public.repair_requests;
create trigger guard_client_request_identity_trigger
  before update on public.repair_requests
  for each row execute function public.guard_client_request_identity();

-- Message membership also depends on the offer's immutable conversation identity.
create or replace function public.guard_client_offer_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if auth.uid() is null
    or new.id is distinct from old.id
    or new.request_id is distinct from old.request_id
    or new.workshop_user_id is distinct from old.workshop_user_id
  then
    raise exception using errcode = '42501', message = 'Offer conversation identity cannot be changed by clients.';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_client_offer_identity() from public, anon, authenticated;
grant execute on function public.guard_client_offer_identity() to service_role;
drop trigger if exists guard_client_offer_identity_trigger on public.repair_offers;
create trigger guard_client_offer_identity_trigger
  before update on public.repair_offers
  for each row execute function public.guard_client_offer_identity();

-- Keep public profile reads, but restrict client writes to onboarding/account fields.
revoke all privileges on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant insert (
  id, email, full_name, role, workshop_name, workshop_phone, workshop_address,
  workshop_city, workshop_hours, workshop_description, workshop_logo_url,
  workshop_gallery_urls, workshop_slug, display_name, city, gdpr_accepted,
  gdpr_accepted_at
) on table public.profiles to authenticated;
grant update (
  id, email, full_name, role, workshop_name, workshop_phone, workshop_address,
  workshop_city, workshop_hours, workshop_description, workshop_logo_url,
  workshop_gallery_urls, workshop_slug, display_name, city, gdpr_accepted,
  gdpr_accepted_at
) on table public.profiles to authenticated;

drop policy if exists "Allow insert for authenticated users" on public.profiles;
create policy "Allow insert for authenticated users"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "Allow update for authenticated users" on public.profiles;
create policy "Allow update for authenticated users"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create or replace function public.guard_client_profile_identity_and_roles()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous_roles text[];
  previous_protected_roles text[];
  next_protected_roles text[];
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if auth.uid() is null or new.id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'A profile can only be written by its owner.';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception using errcode = '42501', message = 'Profile identity cannot be changed.';
    end if;
    previous_roles := old.role;
  else
    -- UPSERT runs BEFORE INSERT first. Preserve existing privileged roles;
    -- the UPDATE invocation then checks against the actual conflicting row.
    select profile.role into previous_roles
    from public.profiles as profile
    where profile.id = new.id;
  end if;

  select array(
    select distinct role_name
    from pg_catalog.unnest(coalesce(previous_roles, '{}'::text[])) as roles(role_name)
    where role_name is null or role_name not in ('customer', 'workshop')
    order by role_name
  ) into previous_protected_roles;

  select array(
    select distinct role_name
    from pg_catalog.unnest(coalesce(new.role, '{}'::text[])) as roles(role_name)
    where role_name is null or role_name not in ('customer', 'workshop')
    order by role_name
  ) into next_protected_roles;

  if next_protected_roles is distinct from previous_protected_roles then
    raise exception using errcode = '42501', message = 'Privileged profile roles cannot be changed by clients.';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_client_profile_identity_and_roles() from public, anon, authenticated;
grant execute on function public.guard_client_profile_identity_and_roles() to service_role;

drop trigger if exists guard_client_profile_identity_and_roles_trigger on public.profiles;
create trigger guard_client_profile_identity_and_roles_trigger
  before insert or update on public.profiles
  for each row execute function public.guard_client_profile_identity_and_roles();

-- A conversation is (request_id, offer_id), not every offer on a request.
-- Definer access is needed to check membership independently of discovery RLS.
create or replace function public.is_message_conversation_participant(
  p_request_id uuid,
  p_offer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null and exists (
    select 1
    from public.repair_requests as request
    where request.id = p_request_id
      and (
        (
          p_offer_id is null
          and request.request_type = 'direct_message'
          and request.target_workshop_id is not null
          and (request.user_id = auth.uid() or request.target_workshop_id = auth.uid())
        )
        or (
          p_offer_id is not null
          and exists (
            select 1
            from public.repair_offers as offer
            where offer.id = p_offer_id
              and offer.request_id = request.id
              and (request.user_id = auth.uid() or offer.workshop_user_id = auth.uid())
          )
        )
      )
  );
$function$;

revoke all on function public.is_message_conversation_participant(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_message_conversation_participant(uuid, uuid) to authenticated, service_role;

revoke all privileges on table public.messages from public, anon, authenticated;
grant select on table public.messages to authenticated;
grant insert (request_id, offer_id, sender_id, sender_role, message, images)
  on table public.messages to authenticated;
grant update (read_at) on table public.messages to authenticated;

drop policy if exists messages_select_authenticated on public.messages;
create policy messages_select_authenticated
  on public.messages for select to authenticated
  using (public.is_message_conversation_participant(request_id, offer_id));

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_role = 'user'
    and public.is_message_conversation_participant(request_id, offer_id)
  );

drop policy if exists messages_update_authenticated on public.messages;
create policy messages_update_authenticated
  on public.messages for update to authenticated
  using (
    public.is_message_conversation_participant(request_id, offer_id)
    and sender_id <> (select auth.uid())
    and sender_role <> 'system'
    and read_at is null
  )
  with check (
    public.is_message_conversation_participant(request_id, offer_id)
    and sender_id <> (select auth.uid())
    and sender_role <> 'system'
    and read_at is not null
  );

-- This existing definer RPC must not bypass the conversation-level SELECT rule.
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
    and public.is_message_conversation_participant(m.request_id, m.offer_id);
$function$;

revoke all on function public.get_unread_messages_count() from public, anon, authenticated;
grant execute on function public.get_unread_messages_count() to authenticated, service_role;

-- Only fixed server-owned text can be emitted as a conversation starter.
create or replace function public.ensure_message_conversation_started(
  p_request_id uuid,
  p_offer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not public.is_message_conversation_participant(p_request_id, p_offer_id)
  then
    raise exception using errcode = '42501', message = 'Conversation access denied.';
  end if;

  -- Serialize simultaneous starter RPC calls without introducing a new channel.
  perform 1 from public.repair_requests where id = p_request_id for update;
  if not found
    or not public.is_message_conversation_participant(p_request_id, p_offer_id)
  then
    raise exception using errcode = '42501', message = 'Conversation access denied.';
  end if;

  if not exists (
    select 1 from public.messages
    where request_id = p_request_id and offer_id is not distinct from p_offer_id
  ) then
    insert into public.messages (request_id, offer_id, sender_id, sender_role, message, images)
    values (
      p_request_id, p_offer_id, auth.uid(), 'system',
      'Conversația a fost începută din profilul service-ului.', '[]'::jsonb
    );
  end if;
end;
$function$;

revoke execute on function public.ensure_message_conversation_started(uuid, uuid) from public;
revoke execute on function public.ensure_message_conversation_started(uuid, uuid) from anon;
revoke execute on function public.ensure_message_conversation_started(uuid, uuid) from authenticated;
revoke execute on function public.ensure_message_conversation_started(uuid, uuid) from service_role;
grant execute on function public.ensure_message_conversation_started(uuid, uuid) to authenticated;

-- Explicit data-owner decision, NOT an inference from the winning offer.
-- Only these three reviewed messages may be associated. Any drift aborts all DDL/DML.
do $legacy$
declare
  mapping record;
  message_row public.messages%rowtype;
  request_row public.repair_requests%rowtype;
  offer_row public.repair_offers%rowtype;
begin
  for mapping in
    select * from (values
      (
        'df2801f4-2ab2-47ea-904a-337818869ca1'::uuid,
        'adec5dc7-4bf1-4471-9333-19024c6715eb'::uuid,
        '2f640eaa-947f-4a7e-8182-3d8d8fa9d6e7'::uuid,
        'addd4335-1684-422e-ad40-6181cb49fc53'::uuid,
        '913cabdd-9b95-4cf8-9d67-385cb0f1845f'::uuid,
        'addd4335-1684-422e-ad40-6181cb49fc53'::uuid,
        'system', '2026-08-18 07:22:03.902372+00'::timestamptz,
        '2026-08-18 06:57:34.515407+00'::timestamptz, 'matched'
      ),
      (
        '31b0d85e-d13d-466b-9bea-204b25904e12'::uuid,
        'ea6172b3-1173-4f14-b436-795bc6bd04d1'::uuid,
        '3fe845f9-0647-458e-b168-b3cb0150b58f'::uuid,
        '962a3f45-2483-45d7-ad8b-a49fced8f55c'::uuid,
        'c6142ff9-777b-45ad-aa5b-d00c55414a92'::uuid,
        'c6142ff9-777b-45ad-aa5b-d00c55414a92'::uuid,
        'system', '2026-08-16 13:47:00.484774+00'::timestamptz,
        '2026-08-15 13:48:58.832077+00'::timestamptz, 'completed'
      ),
      (
        '834f9a46-5134-4062-a70c-28f2d216193a'::uuid,
        'ea6172b3-1173-4f14-b436-795bc6bd04d1'::uuid,
        '3fe845f9-0647-458e-b168-b3cb0150b58f'::uuid,
        '962a3f45-2483-45d7-ad8b-a49fced8f55c'::uuid,
        'c6142ff9-777b-45ad-aa5b-d00c55414a92'::uuid,
        'c6142ff9-777b-45ad-aa5b-d00c55414a92'::uuid,
        'user', '2026-08-16 13:47:13.195687+00'::timestamptz,
        '2026-08-15 13:48:58.832077+00'::timestamptz, 'completed'
      )
    ) as approved(message_id, request_id, offer_id, owner_id, workshop_id,
      sender_id, sender_role, message_created_at, offer_created_at, request_status)
  loop
    select * into message_row from public.messages where id = mapping.message_id;
    if not found then
      raise exception 'Authorized legacy message missing; review required.';
    end if;
    select * into request_row from public.repair_requests where id = mapping.request_id;
    if not found then
      raise exception 'Authorized legacy request missing; review required.';
    end if;
    select * into offer_row from public.repair_offers where id = mapping.offer_id;
    if not found then
      raise exception 'Authorized legacy offer missing; review required.';
    end if;

    if message_row.request_id is distinct from mapping.request_id
      or message_row.sender_id is distinct from mapping.sender_id
      or message_row.sender_role is distinct from mapping.sender_role
      or message_row.created_at is distinct from mapping.message_created_at
      or (message_row.offer_id is not null and message_row.offer_id is distinct from mapping.offer_id)
      or request_row.user_id is distinct from mapping.owner_id
      or request_row.request_type is distinct from 'repair'
      or request_row.status is distinct from mapping.request_status
      or request_row.accepted_offer_id is distinct from mapping.offer_id
      or offer_row.request_id is distinct from mapping.request_id
      or offer_row.workshop_user_id is distinct from mapping.workshop_id
      or offer_row.status is distinct from 'accepted'
      or offer_row.created_at is distinct from mapping.offer_created_at
      or offer_row.created_at > message_row.created_at
      or (select count(*) from public.repair_offers where request_id = mapping.request_id) <> 1
      or not exists (
        select 1 from public.messages where request_id = mapping.request_id
          and offer_id = mapping.offer_id and sender_id = mapping.owner_id
      )
      or not exists (
        select 1 from public.messages where request_id = mapping.request_id
          and offer_id = mapping.offer_id and sender_id = mapping.workshop_id
      )
    then
      raise exception 'Authorized legacy mapping changed; review required.';
    end if;

    update public.messages set offer_id = mapping.offer_id
    where id = mapping.message_id and offer_id is null;
  end loop;

  if exists (
    select 1 from public.messages as message
    join public.repair_requests as request on request.id = message.request_id
    where message.offer_id is null and request.request_type is distinct from 'direct_message'
  ) then
    raise exception 'Unreviewed non-direct legacy messages remain; review required.';
  end if;
end;
$legacy$;

commit;
