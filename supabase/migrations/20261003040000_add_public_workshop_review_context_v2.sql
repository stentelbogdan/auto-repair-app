begin;

create function public.get_public_workshop_review_context_v2(
  p_workshop_id uuid
)
returns table (
  review_id uuid,
  request_id uuid,
  car_year text,
  city text,
  customer_display_name text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    review.id as review_id,
    request.id as request_id,
    request.car_year::text,
    request.city::text,
    coalesce(
      nullif(pg_catalog.btrim(customer_profile.display_name), ''),
      'Client'
    ) as customer_display_name
  from public.reviews as review
  join public.repair_requests as request
    on request.id = review.request_id
  left join public.profiles as customer_profile
    on customer_profile.id = review.customer_user_id
  where review.workshop_user_id = p_workshop_id;
$function$;

revoke all
on function public.get_public_workshop_review_context_v2(uuid)
from public, anon, authenticated;

grant execute
on function public.get_public_workshop_review_context_v2(uuid)
to anon, authenticated, service_role;

commit;
