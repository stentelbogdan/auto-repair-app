begin;

do $dependency_check$
declare
  function_oid oid := pg_catalog.to_regprocedure(
    'public.get_admin_workshop_details(uuid)'
  );
  dependent_objects text;
begin
  if function_oid is null then
    raise exception using
      errcode = '42883',
      message = 'Required function is missing';
  end if;

  select pg_catalog.string_agg(
    pg_catalog.pg_describe_object(
      dependency.classid,
      dependency.objid,
      dependency.objsubid
    ),
    ', '
  )
  into dependent_objects
  from pg_catalog.pg_depend as dependency
  where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    and dependency.refobjid = function_oid
    and dependency.deptype in ('n', 'a');

  if dependent_objects is not null then
    raise exception using
      errcode = '2BP01',
      message = 'Cannot replace function because dependent objects exist';
  end if;
end;
$dependency_check$;

drop function public.get_admin_workshop_details(uuid);

create function public.get_admin_workshop_details(p_workshop_id uuid)
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
  average_rating numeric,
  workshop_phone text,
  workshop_email text,
  work_area_locality text,
  work_area_country_code text,
  work_area_radius_km integer,
  workshop_gallery_urls text[]
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
    reviews.average_rating,
    profile.workshop_phone,
    auth_user.email::text as workshop_email,
    service_area.locality as work_area_locality,
    service_area.country_code as work_area_country_code,
    service_area.radius_km as work_area_radius_km,
    coalesce(
      profile.workshop_gallery_urls,
      '{}'::text[]
    ) as workshop_gallery_urls
  from public.profiles as profile
  left join auth.users as auth_user
    on auth_user.id = profile.id
  left join public.workshop_service_areas as service_area
    on service_area.workshop_id = profile.id
  cross join offer_stats as offers
  cross join accepted_job_stats as accepted_jobs
  cross join review_stats as reviews
  where profile.id = p_workshop_id
    and 'workshop' = any(coalesce(profile.role, '{}'::text[]));
end;
$function$;

revoke execute on function public.get_admin_workshop_details(uuid) from public;
revoke execute on function public.get_admin_workshop_details(uuid) from anon;
revoke execute on function public.get_admin_workshop_details(uuid) from authenticated;
grant execute on function public.get_admin_workshop_details(uuid) to authenticated;

commit;
