begin;

create function public.get_admin_workshop_details(
  p_workshop_id uuid
)
returns table (
  workshop_id uuid,
  workshop_name text,
  created_at timestamptz,
  workshop_description text,
  workshop_city text,
  workshop_hours text,
  workshop_specializations text[],
  workshop_logo_url text,
  total_offer_count bigint,
  accepted_job_count bigint,
  in_progress_job_count bigint,
  completed_job_count bigint,
  review_count bigint,
  average_rating numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Not authorized.';
  end if;

  if p_workshop_id is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid workshop identifier.';
  end if;

  return query
  with offer_stats as (
    select pg_catalog.count(*) as total_offer_count
    from public.repair_offers as offer
    where offer.workshop_user_id = p_workshop_id
  ),
  accepted_job_stats as (
    select
      pg_catalog.count(distinct request.id) as accepted_job_count,
      pg_catalog.count(distinct request.id) filter (
        where request.status = 'in_progress'
      ) as in_progress_job_count,
      pg_catalog.count(distinct request.id) filter (
        where request.status = 'completed'
      ) as completed_job_count
    from public.repair_requests as request
    join public.repair_offers as accepted_offer
      on accepted_offer.id = request.accepted_offer_id
      and accepted_offer.request_id = request.id
      and accepted_offer.workshop_user_id = p_workshop_id
      and accepted_offer.status = 'accepted'
  ),
  review_stats as (
    select
      pg_catalog.count(distinct review.id) as review_count,
      pg_catalog.avg(review.rating::numeric) as average_rating
    from public.reviews as review
    where review.workshop_user_id = p_workshop_id
  )
  select
    profile.id,
    coalesce(
      nullif(pg_catalog.btrim(profile.workshop_name), ''),
      nullif(pg_catalog.btrim(profile.display_name), ''),
      'Service'
    ),
    profile.created_at,
    profile.workshop_description,
    profile.workshop_city,
    profile.workshop_hours,
    coalesce(profile.workshop_specializations, '{}'::text[]),
    profile.workshop_logo_url,
    offers.total_offer_count,
    accepted_jobs.accepted_job_count,
    accepted_jobs.in_progress_job_count,
    accepted_jobs.completed_job_count,
    reviews.review_count,
    reviews.average_rating
  from public.profiles as profile
  cross join offer_stats as offers
  cross join accepted_job_stats as accepted_jobs
  cross join review_stats as reviews
  where profile.id = p_workshop_id
    and 'workshop' = any(coalesce(profile.role, '{}'::text[]));
end;
$function$;

revoke execute
  on function public.get_admin_workshop_details(uuid)
  from public;
revoke execute
  on function public.get_admin_workshop_details(uuid)
  from anon;
revoke execute
  on function public.get_admin_workshop_details(uuid)
  from authenticated;
grant execute
  on function public.get_admin_workshop_details(uuid)
  to authenticated;

commit;
