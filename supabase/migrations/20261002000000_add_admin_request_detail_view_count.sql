begin;

do $dependency_check$
declare
  function_oid pg_catalog.oid := pg_catalog.to_regprocedure(
    'public.get_admin_request_detail(uuid)'
  );
  dependent_objects text;
begin
  if function_oid is null then
    raise exception using
      errcode = '42883',
      message = 'Required admin request detail function is missing.';
  end if;

  select pg_catalog.string_agg(
    pg_catalog.pg_describe_object(
      dependency.classid,
      dependency.objid,
      dependency.objsubid
    ),
    ', '
    order by pg_catalog.pg_describe_object(
      dependency.classid,
      dependency.objid,
      dependency.objsubid
    )
  )
  into dependent_objects
  from pg_catalog.pg_depend as dependency
  where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
    and dependency.refobjid = function_oid
    and dependency.deptype in ('n', 'a');

  if dependent_objects is not null then
    raise exception using
      errcode = '2BP01',
      message = 'Admin request detail function has dependent database objects.';
  end if;
end;
$dependency_check$;

drop function public.get_admin_request_detail(uuid);

create function public.get_admin_request_detail(p_request_id uuid)
returns table (
  request_id uuid,
  category text,
  request_type text,
  request_status text,
  created_at timestamptz,
  customer_display_name text,
  city text,
  car_brand text,
  car_model text,
  car_year text,
  license_plate text,
  damage_type text,
  service_details jsonb,
  description text,
  request_images jsonb,
  target_workshop_name text,
  accepted_workshop_name text,
  accepted_offer_price text,
  accepted_offer_days text,
  appointment_status text,
  appointment_date text,
  appointment_time text,
  appointment_original_date text,
  appointment_original_time text,
  appointment_proposed_date text,
  appointment_proposed_time text,
  handover_method text,
  latest_progress_status text,
  progress_update_count bigint,
  view_count bigint,
  latest_progress_at timestamptz,
  completion_timestamp timestamptz,
  progress_timeline jsonb,
  towing_schedule_type text,
  towing_requested_at timestamptz,
  route_distance_meters double precision,
  route_duration_seconds double precision
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

  if p_request_id is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid request id.';
  end if;

  return query
  select
    request.id,
    case
      when request.service_type in (
        'bodywork',
        'mechanical',
        'wheels',
        'towing'
      ) then request.service_type
      else 'bodywork'
    end as request_category,
    coalesce(request.request_type, 'repair') as normalized_request_type,
    request.status,
    request.created_at,
    coalesce(
      nullif(pg_catalog.btrim(customer_profile.display_name), ''),
      'Client'
    ) as customer_name,
    request.city,
    request.car_brand,
    request.car_model,
    request.car_year::text,
    request.license_plate,
    request.damage_type,
    case
      when request.service_type = 'towing'
        and pg_catalog.jsonb_typeof(request.service_details) = 'object'
      then pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'version', request.service_details -> 'version',
          'kind', request.service_details -> 'kind',
          'pickup', pg_catalog.jsonb_strip_nulls(
            pg_catalog.jsonb_build_object(
              'city', request.service_details #> '{pickup,city}'
            )
          ),
          'destination', pg_catalog.jsonb_strip_nulls(
            pg_catalog.jsonb_build_object(
              'city', request.service_details #> '{destination,city}'
            )
          ),
          'reason', request.service_details -> 'reason',
          'vehicleCondition', request.service_details -> 'vehicleCondition'
        )
      )
      when request.service_type = 'mechanical'
        and pg_catalog.jsonb_typeof(request.service_details) = 'object'
      then pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'version', request.service_details -> 'version',
          'kind', request.service_details -> 'kind',
          'category', request.service_details -> 'category',
          'symptomIds', request.service_details -> 'symptomIds',
          'selections', request.service_details -> 'selections'
        )
      )
      when request.service_type = 'wheels'
        and pg_catalog.jsonb_typeof(request.service_details) = 'object'
      then pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'version', request.service_details -> 'version',
          'kind', request.service_details -> 'kind',
          'selectedWheels', request.service_details -> 'selectedWheels',
          'issuesByWheel', request.service_details -> 'issuesByWheel',
          'generalIssues', request.service_details -> 'generalIssues',
          'services', request.service_details -> 'services',
          'selections', request.service_details -> 'selections',
          'wheelSize', request.service_details -> 'wheelSize',
          'partsSupply', request.service_details -> 'partsSupply'
        )
      )
      when coalesce(request.service_type, 'bodywork') = 'bodywork'
        and pg_catalog.jsonb_typeof(request.service_details) = 'object'
      then pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'version', request.service_details -> 'version',
          'selectedServices', request.service_details -> 'selectedServices',
          'carDamage', request.service_details -> 'carDamage',
          'options', request.service_details -> 'options'
        )
      )
      when coalesce(request.service_type, 'bodywork') = 'bodywork'
        and pg_catalog.jsonb_typeof(request.service_details) = 'array'
      then request.service_details
      else null
    end as safe_service_details,
    request.description,
    coalesce(sanitized_images.images, '[]'::jsonb),
    case
      when coalesce(request.request_type, 'repair') = 'direct_request'
      then coalesce(
        nullif(pg_catalog.btrim(target_workshop_profile.workshop_name), ''),
        case when request.target_workshop_id is not null then 'Service' end
      )
      else null
    end as direct_target_workshop_name,
    coalesce(
      nullif(pg_catalog.btrim(accepted_workshop_profile.workshop_name), ''),
      nullif(pg_catalog.btrim(accepted_offer.workshop_name), ''),
      case when accepted_offer.id is not null then 'Service' end
    ) as accepted_service_name,
    accepted_offer.price::text,
    accepted_offer.days::text,
    appointment.status,
    appointment.appointment_date::text,
    appointment.appointment_time::text,
    appointment.original_date::text,
    appointment.original_time::text,
    appointment.proposed_date::text,
    appointment.proposed_time::text,
    appointment.handover_method,
    progress.latest_status,
    coalesce(progress.update_count, 0::bigint),
    view_metrics.view_count,
    progress.latest_at,
    progress.completed_at,
    coalesce(progress.timeline, '[]'::jsonb),
    request.towing_schedule_type,
    request.towing_requested_at,
    request.route_distance_meters,
    request.route_duration_seconds
  from public.repair_requests as request
  left join public.profiles as customer_profile
    on customer_profile.id = request.user_id
  left join public.profiles as target_workshop_profile
    on target_workshop_profile.id = request.target_workshop_id
   and coalesce(request.request_type, 'repair') = 'direct_request'
  left join public.repair_offers as accepted_offer
    on accepted_offer.id = request.accepted_offer_id
   and accepted_offer.request_id = request.id
   and accepted_offer.status = 'accepted'
  left join public.profiles as accepted_workshop_profile
    on accepted_workshop_profile.id = accepted_offer.workshop_user_id
  left join lateral (
    select
      candidate_appointment.status,
      candidate_appointment.appointment_date,
      candidate_appointment.appointment_time,
      candidate_appointment.original_date,
      candidate_appointment.original_time,
      candidate_appointment.proposed_date,
      candidate_appointment.proposed_time,
      candidate_appointment.handover_method
    from public.repair_appointments as candidate_appointment
    where candidate_appointment.request_id = request.id
      and candidate_appointment.offer_id = accepted_offer.id
      and candidate_appointment.workshop_id = accepted_offer.workshop_user_id
    order by
      candidate_appointment.updated_at desc nulls last,
      candidate_appointment.id desc
    limit 1
  ) as appointment on true
  left join lateral (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'url', nullif(pg_catalog.btrim(image_item.value ->> 'url'), ''),
          'thumb_url', nullif(
            pg_catalog.btrim(
              coalesce(
                image_item.value ->> 'thumbUrl',
                image_item.value ->> 'thumb_url'
              )
            ),
            ''
          )
        )
      )
      order by image_item.ordinality
    ) as images
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(request.images) = 'array'
        then request.images
        else '[]'::jsonb
      end
    ) with ordinality as image_item(value, ordinality)
    where pg_catalog.jsonb_typeof(image_item.value) = 'object'
      and (
        nullif(pg_catalog.btrim(image_item.value ->> 'url'), '') is not null
        or nullif(
          pg_catalog.btrim(
            coalesce(
              image_item.value ->> 'thumbUrl',
              image_item.value ->> 'thumb_url'
            )
          ),
          ''
        ) is not null
      )
  ) as sanitized_images on true
  left join lateral (
    select pg_catalog.count(*) as view_count
    from public.repair_request_views as request_view
    where request_view.request_id = request.id
  ) as view_metrics on true
  left join lateral (
    select
      (
        pg_catalog.array_agg(
          progress_update.status
          order by progress_update.created_at desc, progress_update.id desc
        )
      )[1] as latest_status,
      pg_catalog.count(*) as update_count,
      pg_catalog.max(progress_update.created_at) as latest_at,
      pg_catalog.max(progress_update.created_at) filter (
        where pg_catalog.lower(pg_catalog.btrim(progress_update.status))
          in ('ready', 'gata')
      ) as completed_at,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'status', progress_update.status,
          'created_at', progress_update.created_at
        )
        order by progress_update.created_at asc, progress_update.id asc
      ) as timeline
    from public.work_progress_updates as progress_update
    where progress_update.request_id = request.id
  ) as progress on true
  where request.id = p_request_id
    and coalesce(request.request_type, 'repair') in (
      'repair',
      'direct_request'
    );
end;
$function$;


revoke all on function public.get_admin_request_detail(uuid)
from public, anon, authenticated;
grant execute on function public.get_admin_request_detail(uuid)
to authenticated;

commit;
