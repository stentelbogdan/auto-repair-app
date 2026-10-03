begin;

create function public.get_admin_reviews(
  p_search text default null,
  p_ratings integer[] default null,
  p_workshop_id uuid default null,
  p_sort text default 'created_at',
  p_direction text default 'desc',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 25
)
returns table (
  review_id uuid,
  request_id uuid,
  rating integer,
  review_text text,
  created_at timestamptz,
  customer_display_name text,
  workshop_name text,
  request_category text,
  request_status text
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
  normalized_ratings integer[] := '{}'::integer[];
  normalized_sort text := pg_catalog.lower(pg_catalog.btrim(p_sort));
  normalized_direction text := pg_catalog.lower(pg_catalog.btrim(p_direction));
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Not authorized.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
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

  if p_ratings is not null
    and exists (
      select 1
      from pg_catalog.unnest(p_ratings) as requested(rating_value)
      where requested.rating_value is null
        or requested.rating_value < 1
        or requested.rating_value > 5
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid rating filter.';
  end if;

  if p_ratings is not null then
    select coalesce(
      pg_catalog.array_agg(
        distinct requested.rating_value
        order by requested.rating_value
      ),
      '{}'::integer[]
    )
    into normalized_ratings
    from pg_catalog.unnest(p_ratings) as requested(rating_value);
  end if;

  if normalized_sort is null or normalized_sort <> 'created_at' then
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

  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using
      errcode = '22023',
      message = 'Invalid cursor.';
  end if;

  return query
  with review_rows as (
    select
      review.id,
      review.request_id,
      review.rating,
      review.comment,
      review.created_at,
      coalesce(
        nullif(pg_catalog.btrim(customer_profile.display_name), ''),
        'Client'
      ) as customer_name,
      coalesce(
        nullif(pg_catalog.btrim(workshop_profile.workshop_name), ''),
        'Service'
      ) as public_workshop_name,
      case
        when request.service_type in (
          'bodywork',
          'mechanical',
          'wheels',
          'towing'
        ) then request.service_type
        else 'bodywork'
      end as category,
      request.status
    from public.reviews as review
    left join public.repair_requests as request
      on request.id = review.request_id
    left join public.profiles as customer_profile
      on customer_profile.id = review.customer_user_id
    left join public.profiles as workshop_profile
      on workshop_profile.id = review.workshop_user_id
    where (
      p_workshop_id is null
      or review.workshop_user_id = p_workshop_id
    )
      and (
        pg_catalog.cardinality(normalized_ratings) = 0
        or review.rating = any(normalized_ratings)
      )
  ),
  candidates as (
    select review_row.*
    from review_rows as review_row
    where normalized_search is null
      or pg_catalog.strpos(
        pg_catalog.lower(
          pg_catalog.concat_ws(
            ' ',
            coalesce(review_row.comment, ''),
            review_row.customer_name,
            review_row.public_workshop_name
          )
        ),
        normalized_search
      ) > 0
  ),
  paged as (
    select candidate.*
    from candidates as candidate
    where p_cursor_id is null
      or (
        normalized_direction = 'asc'
        and (candidate.created_at, candidate.id)
          > (p_cursor_created_at, p_cursor_id)
      )
      or (
        normalized_direction = 'desc'
        and (candidate.created_at, candidate.id)
          < (p_cursor_created_at, p_cursor_id)
      )
    order by
      case
        when normalized_direction = 'asc' then candidate.created_at
      end asc,
      case
        when normalized_direction = 'desc' then candidate.created_at
      end desc,
      case when normalized_direction = 'asc' then candidate.id end asc,
      case when normalized_direction = 'desc' then candidate.id end desc
    limit p_limit
  )
  select
    page.id,
    page.request_id,
    page.rating,
    page.comment,
    page.created_at,
    page.customer_name,
    page.public_workshop_name,
    page.category,
    page.status
  from paged as page
  order by
    case when normalized_direction = 'asc' then page.created_at end asc,
    case when normalized_direction = 'desc' then page.created_at end desc,
    case when normalized_direction = 'asc' then page.id end asc,
    case when normalized_direction = 'desc' then page.id end desc;
end;
$function$;

revoke execute on function public.get_admin_reviews(
  text,
  integer[],
  uuid,
  text,
  text,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;

grant execute on function public.get_admin_reviews(
  text,
  integer[],
  uuid,
  text,
  text,
  timestamptz,
  uuid,
  integer
) to authenticated;

commit;
