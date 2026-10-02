begin;

do $dependency_check$
declare
  function_oid pg_catalog.oid := pg_catalog.to_regprocedure(
    'public.get_admin_requests(text,text,text,text,timestamptz,uuid,integer)'
  );
  dependent_objects text;
begin
  if function_oid is null then
    raise exception using
      errcode = '42883',
      message = 'Required admin requests function is missing.';
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
      message = 'Admin requests function has dependent database objects.';
  end if;
end;
$dependency_check$;

drop function public.get_admin_requests(
  text,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer
);

create function public.get_admin_requests(
  p_search text default null,
  p_status text default null,
  p_category text default null,
  p_direction text default 'desc',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 25
)
returns table (
  request_id uuid,
  category text,
  status text,
  request_type text,
  created_at timestamptz,
  customer_display_name text,
  city text,
  license_plate text,
  workshop_name text,
  accepted_offer_price text,
  appointment_status text,
  appointment_date text,
  appointment_time text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  normalized_search text := nullif(
    pg_catalog.lower(pg_catalog.btrim(p_search)),
    ''
  );
  normalized_plate_search text := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.upper(pg_catalog.btrim(p_search)),
      '[^A-Z0-9]',
      '',
      'g'
    ),
    ''
  );
  normalized_status text := nullif(
    pg_catalog.lower(pg_catalog.btrim(p_status)),
    ''
  );
  normalized_category text := nullif(
    pg_catalog.lower(pg_catalog.btrim(p_category)),
    ''
  );
  normalized_direction text := pg_catalog.lower(pg_catalog.btrim(p_direction));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Not authorized.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using
      errcode = '22023',
      message = 'Invalid page size.';
  end if;

  if p_search is not null
    and pg_catalog.char_length(pg_catalog.btrim(p_search)) > 100
  then
    raise exception using
      errcode = '22023',
      message = 'Search is too long.';
  end if;

  if p_status is not null
    and normalized_status is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid status filter.';
  end if;

  if normalized_status is not null
    and normalized_status not in (
      'open',
      'matched',
      'in_progress',
      'completed',
      'closed'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid status filter.';
  end if;

  if p_category is not null
    and normalized_category is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid category filter.';
  end if;

  if normalized_category is not null
    and normalized_category not in (
      'bodywork',
      'mechanical',
      'wheels',
      'towing'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid category filter.';
  end if;

  if normalized_direction is null
    or normalized_direction not in ('asc', 'desc')
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid sort direction.';
  end if;

  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  end if;

  return query
  with candidates as (
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
      request.status,
      coalesce(request.request_type, 'repair') as normalized_request_type,
      request.created_at,
      coalesce(
        nullif(pg_catalog.btrim(customer_profile.display_name), ''),
        'Client'
      ) as customer_name,
      request.city,
      request.license_plate,
      coalesce(
        nullif(pg_catalog.btrim(accepted_workshop_profile.workshop_name), ''),
        nullif(pg_catalog.btrim(accepted_offer.workshop_name), ''),
        nullif(pg_catalog.btrim(target_workshop_profile.workshop_name), ''),
        case
          when accepted_offer.id is not null
            or request.target_workshop_id is not null
          then 'Service'
          else null
        end
      ) as associated_workshop_name,
      accepted_offer.price::text as offer_price,
      appointment.status as latest_appointment_status,
      case
        when appointment.status = 'confirmed'
          then appointment.appointment_date::text
        else coalesce(
          appointment.proposed_date,
          appointment.appointment_date
        )::text
      end as effective_appointment_date,
      case
        when appointment.status = 'confirmed'
          then appointment.appointment_time::text
        else coalesce(
          appointment.proposed_time,
          appointment.appointment_time
        )::text
      end as effective_appointment_time
    from public.repair_requests as request
    left join public.profiles as customer_profile
      on customer_profile.id = request.user_id
    left join public.repair_offers as accepted_offer
      on accepted_offer.id = request.accepted_offer_id
     and accepted_offer.request_id = request.id
     and accepted_offer.status = 'accepted'
    left join public.profiles as accepted_workshop_profile
      on accepted_workshop_profile.id = accepted_offer.workshop_user_id
    left join public.profiles as target_workshop_profile
      on target_workshop_profile.id = request.target_workshop_id
     and coalesce(request.request_type, 'repair') = 'direct_request'
    left join lateral (
      select
        candidate_appointment.status,
        candidate_appointment.appointment_date,
        candidate_appointment.appointment_time,
        candidate_appointment.proposed_date,
        candidate_appointment.proposed_time
      from public.repair_appointments as candidate_appointment
      where candidate_appointment.request_id = request.id
        and candidate_appointment.offer_id = accepted_offer.id
        and candidate_appointment.workshop_id = accepted_offer.workshop_user_id
      order by
        candidate_appointment.updated_at desc nulls last,
        candidate_appointment.id desc
      limit 1
    ) as appointment on true
    where coalesce(request.request_type, 'repair') in (
      'repair',
      'direct_request'
    )
  ),
  filtered as (
    select candidate.*
    from candidates as candidate
    where (
      normalized_search is null
      or pg_catalog.strpos(
        pg_catalog.lower(
          pg_catalog.concat_ws(
            ' ',
            coalesce(candidate.customer_name, ''),
            coalesce(candidate.associated_workshop_name, ''),
            coalesce(candidate.city, ''),
            coalesce(candidate.request_category, '')
          )
        ),
        normalized_search
      ) > 0
      or (
        normalized_plate_search is not null
        and pg_catalog.strpos(
          pg_catalog.regexp_replace(
            pg_catalog.upper(coalesce(candidate.license_plate, '')),
            '[^A-Z0-9]',
            '',
            'g'
          ),
          normalized_plate_search
        ) > 0
      )
    )
      and (
        normalized_status is null
        or candidate.status = normalized_status
      )
      and (
        normalized_category is null
        or candidate.request_category = normalized_category
      )
  ),
  paged as (
    select filtered_candidate.*
    from filtered as filtered_candidate
    where p_cursor_id is null
      or (
        normalized_direction = 'asc'
        and (filtered_candidate.created_at, filtered_candidate.id)
          > (p_cursor_created_at, p_cursor_id)
      )
      or (
        normalized_direction = 'desc'
        and (filtered_candidate.created_at, filtered_candidate.id)
          < (p_cursor_created_at, p_cursor_id)
      )
    order by
      case
        when normalized_direction = 'asc'
          then filtered_candidate.created_at
      end asc,
      case
        when normalized_direction = 'desc'
          then filtered_candidate.created_at
      end desc,
      case when normalized_direction = 'asc' then filtered_candidate.id end asc,
      case when normalized_direction = 'desc' then filtered_candidate.id end desc
    limit p_limit
  )
  select
    page.id,
    page.request_category,
    page.status,
    page.normalized_request_type,
    page.created_at,
    page.customer_name,
    page.city,
    page.license_plate,
    page.associated_workshop_name,
    page.offer_price,
    page.latest_appointment_status,
    page.effective_appointment_date,
    page.effective_appointment_time
  from paged as page
  order by
    case
      when normalized_direction = 'asc'
        then page.created_at
    end asc,
    case
      when normalized_direction = 'desc'
        then page.created_at
    end desc,
    case when normalized_direction = 'asc' then page.id end asc,
    case when normalized_direction = 'desc' then page.id end desc;
end;
$function$;

revoke all on function public.get_admin_requests(
  text,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_admin_requests(
  text,
  text,
  text,
  text,
  timestamptz,
  uuid,
  integer
) to authenticated;

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
