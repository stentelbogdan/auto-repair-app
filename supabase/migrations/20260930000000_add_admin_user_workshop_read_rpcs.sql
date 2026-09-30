begin;

create or replace function public.get_admin_users(
  p_search text default null,
  p_roles text[] default null,
  p_sort text default 'created_at',
  p_direction text default 'desc',
  p_cursor_created_at timestamptz default null,
  p_cursor_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 25
)
returns table (
  user_id uuid,
  display_name text,
  city text,
  roles text[],
  created_at timestamptz,
  has_customer_role boolean,
  has_workshop_role boolean,
  has_admin_role boolean
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
  normalized_roles text[] := coalesce(p_roles, '{}'::text[]);
  normalized_sort text := pg_catalog.lower(pg_catalog.btrim(p_sort));
  normalized_direction text := pg_catalog.lower(pg_catalog.btrim(p_direction));
  normalized_cursor_name text;
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

  if pg_catalog.cardinality(normalized_roles) > 3
    or exists (
      select 1
      from pg_catalog.unnest(normalized_roles) as requested(role_name)
      where requested.role_name is null
        or requested.role_name not in ('customer', 'workshop', 'admin')
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid role filter.';
  end if;

  if normalized_sort is null
    or normalized_sort not in ('created_at', 'display_name')
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid sort.';
  end if;

  if normalized_direction is null
    or normalized_direction not in ('asc', 'desc')
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid sort direction.';
  end if;

  if p_cursor_created_at is null
    and p_cursor_name is null
    and p_cursor_id is null
  then
    null;
  elsif p_cursor_id is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  elsif normalized_sort = 'created_at' then
    if p_cursor_created_at is null or p_cursor_name is not null then
      raise exception using
        errcode = '22023',
        message = 'Invalid cursor.';
    end if;
  elsif p_cursor_name is null or p_cursor_created_at is not null then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  end if;

  normalized_cursor_name := case
    when p_cursor_name is null then null
    else pg_catalog.lower(pg_catalog.btrim(p_cursor_name))
  end;

  return query
  with candidates as (
    select
      profile.id,
      profile.display_name,
      profile.city,
      coalesce(profile.role, '{}'::text[]) as roles,
      profile.created_at,
      pg_catalog.lower(
        coalesce(nullif(pg_catalog.btrim(profile.display_name), ''), '')
      ) as sort_name
    from public.profiles as profile
    where (
      normalized_search is null
      or pg_catalog.strpos(
        pg_catalog.lower(
          pg_catalog.concat_ws(
            ' ',
            coalesce(profile.display_name, ''),
            coalesce(profile.city, '')
          )
        ),
        normalized_search
      ) > 0
    )
      and (
        pg_catalog.cardinality(normalized_roles) = 0
        or coalesce(profile.role, '{}'::text[]) && normalized_roles
      )
  ),
  paged as (
    select candidate.*
    from candidates as candidate
    where (
      p_cursor_id is null
      or (
        normalized_sort = 'created_at'
        and (
          (
            normalized_direction = 'asc'
            and (candidate.created_at, candidate.id)
              > (p_cursor_created_at, p_cursor_id)
          )
          or (
            normalized_direction = 'desc'
            and (candidate.created_at, candidate.id)
              < (p_cursor_created_at, p_cursor_id)
          )
        )
      )
      or (
        normalized_sort = 'display_name'
        and (
          (
            normalized_direction = 'asc'
            and (candidate.sort_name, candidate.id)
              > (normalized_cursor_name, p_cursor_id)
          )
          or (
            normalized_direction = 'desc'
            and (candidate.sort_name, candidate.id)
              < (normalized_cursor_name, p_cursor_id)
          )
        )
      )
    )
    order by
      case
        when normalized_sort = 'created_at'
          and normalized_direction = 'asc'
          then candidate.created_at
      end asc,
      case
        when normalized_sort = 'created_at'
          and normalized_direction = 'desc'
          then candidate.created_at
      end desc,
      case
        when normalized_sort = 'display_name'
          and normalized_direction = 'asc'
          then candidate.sort_name
      end asc,
      case
        when normalized_sort = 'display_name'
          and normalized_direction = 'desc'
          then candidate.sort_name
      end desc,
      case when normalized_direction = 'asc' then candidate.id end asc,
      case when normalized_direction = 'desc' then candidate.id end desc
    limit p_limit
  )
  select
    page.id,
    page.display_name,
    page.city,
    page.roles,
    page.created_at,
    'customer' = any(page.roles),
    'workshop' = any(page.roles),
    'admin' = any(page.roles)
  from paged as page
  order by
    case
      when normalized_sort = 'created_at'
        and normalized_direction = 'asc'
        then page.created_at
    end asc,
    case
      when normalized_sort = 'created_at'
        and normalized_direction = 'desc'
        then page.created_at
    end desc,
    case
      when normalized_sort = 'display_name'
        and normalized_direction = 'asc'
        then page.sort_name
    end asc,
    case
      when normalized_sort = 'display_name'
        and normalized_direction = 'desc'
        then page.sort_name
    end desc,
    case when normalized_direction = 'asc' then page.id end asc,
    case when normalized_direction = 'desc' then page.id end desc;
end;
$function$;

revoke all on function public.get_admin_users(
  text,
  text[],
  text,
  text,
  timestamptz,
  text,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_admin_users(
  text,
  text[],
  text,
  text,
  timestamptz,
  text,
  uuid,
  integer
) to authenticated;

create or replace function public.get_admin_workshops(
  p_search text default null,
  p_specializations text[] default null,
  p_sort text default 'created_at',
  p_direction text default 'desc',
  p_cursor_created_at timestamptz default null,
  p_cursor_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 25
)
returns table (
  workshop_id uuid,
  workshop_name text,
  workshop_slug text,
  workshop_city text,
  workshop_logo_url text,
  workshop_specializations text[],
  created_at timestamptz,
  review_count bigint,
  average_rating numeric,
  total_offer_count bigint,
  completed_job_count bigint
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
  normalized_specializations text[] := coalesce(
    p_specializations,
    '{}'::text[]
  );
  normalized_sort text := pg_catalog.lower(pg_catalog.btrim(p_sort));
  normalized_direction text := pg_catalog.lower(pg_catalog.btrim(p_direction));
  normalized_cursor_name text;
  numeric_cursor numeric;
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

  if pg_catalog.cardinality(normalized_specializations) > 50
    or exists (
      select 1
      from pg_catalog.unnest(normalized_specializations)
        as requested(specialization)
      where requested.specialization is null
        or nullif(pg_catalog.btrim(requested.specialization), '') is null
        or pg_catalog.char_length(
          pg_catalog.btrim(requested.specialization)
        ) > 100
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid specialization filter.';
  end if;

  if normalized_sort is null
    or normalized_sort not in (
      'created_at',
      'workshop_name',
      'review_count',
      'average_rating'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid sort.';
  end if;

  if normalized_direction is null
    or normalized_direction not in ('asc', 'desc')
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid sort direction.';
  end if;

  if p_cursor_created_at is null
    and p_cursor_name is null
    and p_cursor_id is null
  then
    null;
  elsif p_cursor_id is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  elsif normalized_sort = 'created_at' then
    if p_cursor_created_at is null or p_cursor_name is not null then
      raise exception using
        errcode = '22023',
        message = 'Invalid cursor.';
    end if;
  elsif p_cursor_name is null or p_cursor_created_at is not null then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  end if;

  if normalized_sort = 'workshop_name' and p_cursor_name is not null then
    normalized_cursor_name := pg_catalog.lower(
      pg_catalog.btrim(p_cursor_name)
    );
  elsif normalized_sort in ('review_count', 'average_rating')
    and p_cursor_name is not null
  then
    if pg_catalog.btrim(p_cursor_name) !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception using
        errcode = '22023',
        message = 'Invalid cursor.';
    end if;

    numeric_cursor := pg_catalog.btrim(p_cursor_name)::numeric;
  end if;

  return query
  with review_stats as (
    select
      review.workshop_user_id as workshop_id,
      pg_catalog.count(*) as review_count,
      pg_catalog.avg(review.rating::numeric) as average_rating
    from public.reviews as review
    group by review.workshop_user_id
  ),
  offer_stats as (
    select
      offer.workshop_user_id as workshop_id,
      pg_catalog.count(*) as total_offer_count
    from public.repair_offers as offer
    group by offer.workshop_user_id
  ),
  completed_job_stats as (
    select
      accepted_offer.workshop_user_id as workshop_id,
      pg_catalog.count(*) as completed_job_count
    from public.repair_requests as request
    join public.repair_offers as accepted_offer
      on accepted_offer.id = request.accepted_offer_id
    where request.status = 'completed'
    group by accepted_offer.workshop_user_id
  ),
  candidates as (
    select
      profile.id,
      profile.workshop_name,
      profile.workshop_slug,
      profile.workshop_city,
      profile.workshop_logo_url,
      coalesce(
        profile.workshop_specializations,
        '{}'::text[]
      ) as workshop_specializations,
      profile.created_at,
      coalesce(reviews.review_count, 0::bigint) as review_count,
      coalesce(reviews.average_rating, 0::numeric) as average_rating,
      coalesce(offers.total_offer_count, 0::bigint) as total_offer_count,
      coalesce(completed_jobs.completed_job_count, 0::bigint)
        as completed_job_count,
      pg_catalog.lower(
        coalesce(nullif(pg_catalog.btrim(profile.workshop_name), ''), '')
      ) as sort_name
    from public.profiles as profile
    left join review_stats as reviews
      on reviews.workshop_id = profile.id
    left join offer_stats as offers
      on offers.workshop_id = profile.id
    left join completed_job_stats as completed_jobs
      on completed_jobs.workshop_id = profile.id
    where 'workshop' = any(coalesce(profile.role, '{}'::text[]))
      and (
        normalized_search is null
        or pg_catalog.strpos(
          pg_catalog.lower(
            pg_catalog.concat_ws(
              ' ',
              coalesce(profile.workshop_name, ''),
              coalesce(profile.workshop_city, ''),
              coalesce(profile.workshop_slug, '')
            )
          ),
          normalized_search
        ) > 0
      )
      and (
        pg_catalog.cardinality(normalized_specializations) = 0
        or coalesce(profile.workshop_specializations, '{}'::text[])
          && normalized_specializations
      )
  ),
  paged as (
    select candidate.*
    from candidates as candidate
    where (
      p_cursor_id is null
      or (
        normalized_sort = 'created_at'
        and (
          (
            normalized_direction = 'asc'
            and (candidate.created_at, candidate.id)
              > (p_cursor_created_at, p_cursor_id)
          )
          or (
            normalized_direction = 'desc'
            and (candidate.created_at, candidate.id)
              < (p_cursor_created_at, p_cursor_id)
          )
        )
      )
      or (
        normalized_sort = 'workshop_name'
        and (
          (
            normalized_direction = 'asc'
            and (candidate.sort_name, candidate.id)
              > (normalized_cursor_name, p_cursor_id)
          )
          or (
            normalized_direction = 'desc'
            and (candidate.sort_name, candidate.id)
              < (normalized_cursor_name, p_cursor_id)
          )
        )
      )
      or (
        normalized_sort = 'review_count'
        and (
          (
            normalized_direction = 'asc'
            and (candidate.review_count::numeric, candidate.id)
              > (numeric_cursor, p_cursor_id)
          )
          or (
            normalized_direction = 'desc'
            and (candidate.review_count::numeric, candidate.id)
              < (numeric_cursor, p_cursor_id)
          )
        )
      )
      or (
        normalized_sort = 'average_rating'
        and (
          (
            normalized_direction = 'asc'
            and (candidate.average_rating, candidate.id)
              > (numeric_cursor, p_cursor_id)
          )
          or (
            normalized_direction = 'desc'
            and (candidate.average_rating, candidate.id)
              < (numeric_cursor, p_cursor_id)
          )
        )
      )
    )
    order by
      case
        when normalized_sort = 'created_at'
          and normalized_direction = 'asc'
          then candidate.created_at
      end asc,
      case
        when normalized_sort = 'created_at'
          and normalized_direction = 'desc'
          then candidate.created_at
      end desc,
      case
        when normalized_sort = 'workshop_name'
          and normalized_direction = 'asc'
          then candidate.sort_name
      end asc,
      case
        when normalized_sort = 'workshop_name'
          and normalized_direction = 'desc'
          then candidate.sort_name
      end desc,
      case
        when normalized_sort = 'review_count'
          and normalized_direction = 'asc'
          then candidate.review_count
      end asc,
      case
        when normalized_sort = 'review_count'
          and normalized_direction = 'desc'
          then candidate.review_count
      end desc,
      case
        when normalized_sort = 'average_rating'
          and normalized_direction = 'asc'
          then candidate.average_rating
      end asc,
      case
        when normalized_sort = 'average_rating'
          and normalized_direction = 'desc'
          then candidate.average_rating
      end desc,
      case when normalized_direction = 'asc' then candidate.id end asc,
      case when normalized_direction = 'desc' then candidate.id end desc
    limit p_limit
  )
  select
    page.id,
    page.workshop_name,
    page.workshop_slug,
    page.workshop_city,
    page.workshop_logo_url,
    page.workshop_specializations,
    page.created_at,
    page.review_count,
    page.average_rating,
    page.total_offer_count,
    page.completed_job_count
  from paged as page
  order by
    case
      when normalized_sort = 'created_at'
        and normalized_direction = 'asc'
        then page.created_at
    end asc,
    case
      when normalized_sort = 'created_at'
        and normalized_direction = 'desc'
        then page.created_at
    end desc,
    case
      when normalized_sort = 'workshop_name'
        and normalized_direction = 'asc'
        then page.sort_name
    end asc,
    case
      when normalized_sort = 'workshop_name'
        and normalized_direction = 'desc'
        then page.sort_name
    end desc,
    case
      when normalized_sort = 'review_count'
        and normalized_direction = 'asc'
        then page.review_count
    end asc,
    case
      when normalized_sort = 'review_count'
        and normalized_direction = 'desc'
        then page.review_count
    end desc,
    case
      when normalized_sort = 'average_rating'
        and normalized_direction = 'asc'
        then page.average_rating
    end asc,
    case
      when normalized_sort = 'average_rating'
        and normalized_direction = 'desc'
        then page.average_rating
    end desc,
    case when normalized_direction = 'asc' then page.id end asc,
    case when normalized_direction = 'desc' then page.id end desc;
end;
$function$;

revoke all on function public.get_admin_workshops(
  text,
  text[],
  text,
  text,
  timestamptz,
  text,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_admin_workshops(
  text,
  text[],
  text,
  text,
  timestamptz,
  text,
  uuid,
  integer
) to authenticated;

commit;
