begin;

create or replace function public.get_public_workshop_profile(
  p_workshop_slug text
)
returns table (
  workshop_id uuid,
  workshop_name text,
  workshop_phone text,
  workshop_address text,
  workshop_city text,
  workshop_hours text,
  workshop_description text,
  workshop_logo_url text,
  workshop_gallery_urls text[],
  workshop_slug text,
  workshop_specializations text[]
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    profile.id as workshop_id,
    profile.workshop_name,
    profile.workshop_phone,
    profile.workshop_address,
    profile.workshop_city,
    profile.workshop_hours,
    profile.workshop_description,
    profile.workshop_logo_url,
    profile.workshop_gallery_urls,
    profile.workshop_slug,
    profile.workshop_specializations
  from public.profiles as profile
  where nullif(pg_catalog.btrim(p_workshop_slug), '') is not null
    and profile.workshop_slug = pg_catalog.btrim(p_workshop_slug)
    and 'workshop' = any(
      coalesce(profile.role, '{}'::text[])
    )
  order by profile.id
  limit 1;
$function$;

revoke all on function public.get_public_workshop_profile(text)
from public;
revoke all on function public.get_public_workshop_profile(text)
from anon, authenticated;
grant execute on function public.get_public_workshop_profile(text)
to anon, authenticated, service_role;

create or replace function public.get_public_workshop_summaries(
  p_workshop_ids uuid[]
)
returns table (
  workshop_id uuid,
  workshop_name text,
  workshop_slug text,
  workshop_logo_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.cardinality(coalesce(p_workshop_ids, '{}'::uuid[])) > 500 then
    raise exception using
      errcode = '22023',
      message = 'Too many workshop identifiers.';
  end if;

  return query
  with requested_ids as (
    select distinct input.workshop_id
    from pg_catalog.unnest(coalesce(p_workshop_ids, '{}'::uuid[]))
      as input(workshop_id)
    where input.workshop_id is not null
  )
  select
    profile.id as workshop_id,
    profile.workshop_name,
    profile.workshop_slug,
    profile.workshop_logo_url
  from requested_ids as requested
  join public.profiles as profile
    on profile.id = requested.workshop_id
  where 'workshop' = any(
    coalesce(profile.role, '{}'::text[])
  );
end;
$function$;

revoke all on function public.get_public_workshop_summaries(uuid[])
from public;
revoke all on function public.get_public_workshop_summaries(uuid[])
from anon, authenticated;
grant execute on function public.get_public_workshop_summaries(uuid[])
to anon, authenticated, service_role;

create or replace function public.get_message_conversation_peers(
  p_direct_request_ids uuid[],
  p_offer_ids uuid[]
)
returns table (
  request_id uuid,
  offer_id uuid,
  peer_id uuid,
  peer_display_name text,
  peer_workshop_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  direct_request_count integer := pg_catalog.cardinality(
    coalesce(p_direct_request_ids, '{}'::uuid[])
  );
  offer_count integer := pg_catalog.cardinality(
    coalesce(p_offer_ids, '{}'::uuid[])
  );
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if direct_request_count + offer_count > 500 then
    raise exception using
      errcode = '22023',
      message = 'Too many conversations.';
  end if;

  return query
  with requested_conversations as (
    select distinct
      direct_request.request_id,
      null::uuid as offer_id
    from pg_catalog.unnest(
      coalesce(p_direct_request_ids, '{}'::uuid[])
    ) as direct_request(request_id)
    where direct_request.request_id is not null

    union

    select distinct
      offer.request_id,
      offer.id as offer_id
    from pg_catalog.unnest(coalesce(p_offer_ids, '{}'::uuid[]))
      as requested_offer(offer_id)
    join public.repair_offers as offer
      on offer.id = requested_offer.offer_id
    where requested_offer.offer_id is not null
  ),
  authorized_conversations as (
    select
      requested.request_id,
      requested.offer_id,
      request.user_id as customer_id,
      case
        when requested.offer_id is null then request.target_workshop_id
        else offer.workshop_user_id
      end as workshop_id
    from requested_conversations as requested
    join public.repair_requests as request
      on request.id = requested.request_id
    left join public.repair_offers as offer
      on offer.id = requested.offer_id
     and offer.request_id = request.id
    where public.is_message_conversation_participant(
      requested.request_id,
      requested.offer_id
    )
  ),
  derived_peers as (
    select
      conversation.request_id,
      conversation.offer_id,
      case
        when conversation.customer_id = current_user_id
          then conversation.workshop_id
        else conversation.customer_id
      end as peer_id,
      conversation.customer_id = current_user_id as peer_is_workshop
    from authorized_conversations as conversation
  )
  select
    peer.request_id,
    peer.offer_id,
    peer.peer_id,
    case
      when peer.peer_is_workshop then coalesce(
        nullif(pg_catalog.btrim(profile.workshop_name), ''),
        'Service'
      )
      else coalesce(
        nullif(pg_catalog.btrim(profile.display_name), ''),
        'Client'
      )
    end as peer_display_name,
    case
      when peer.peer_is_workshop then coalesce(
        nullif(pg_catalog.btrim(profile.workshop_name), ''),
        'Service'
      )
      else null
    end as peer_workshop_name
  from derived_peers as peer
  join public.profiles as profile
    on profile.id = peer.peer_id
  where peer.peer_id is not null;
end;
$function$;

revoke all on function public.get_message_conversation_peers(uuid[], uuid[])
from public;
revoke all on function public.get_message_conversation_peers(uuid[], uuid[])
from anon, authenticated;
grant execute on function public.get_message_conversation_peers(uuid[], uuid[])
to authenticated, service_role;

commit;
