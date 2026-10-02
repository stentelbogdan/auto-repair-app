begin;

create or replace function public.get_admin_customers(
  p_search text default null,
  p_sort text default 'created_at',
  p_direction text default 'desc',
  p_cursor_created_at timestamptz default null,
  p_cursor_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 25
)
returns table (
  customer_id uuid,
  display_name text,
  city text,
  profile_created_at timestamptz,
  total_requests bigint,
  open_requests bigint,
  in_progress_jobs bigint,
  completed_jobs bigint
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
  with request_counts as (
    select
      request.user_id,
      pg_catalog.count(*) as total_requests,
      pg_catalog.count(*) filter (
        where request.status = 'open'
      ) as open_requests,
      pg_catalog.count(*) filter (
        where request.status = 'in_progress'
      ) as in_progress_jobs,
      pg_catalog.count(*) filter (
        where request.status = 'completed'
      ) as completed_jobs
    from public.repair_requests as request
    where coalesce(request.request_type, 'repair') in (
      'repair',
      'direct_request'
    )
    group by request.user_id
  ),
  candidates as (
    select
      profile.id,
      coalesce(
        nullif(pg_catalog.btrim(profile.display_name), ''),
        'Client'
      ) as customer_name,
      profile.city,
      profile.created_at,
      coalesce(requests.total_requests, 0::bigint) as total_requests,
      coalesce(requests.open_requests, 0::bigint) as open_requests,
      coalesce(requests.in_progress_jobs, 0::bigint) as in_progress_jobs,
      coalesce(requests.completed_jobs, 0::bigint) as completed_jobs,
      pg_catalog.lower(
        coalesce(
          nullif(pg_catalog.btrim(profile.display_name), ''),
          'Client'
        )
      ) as sort_name
    from public.profiles as profile
    left join request_counts as requests
      on requests.user_id = profile.id
    where 'customer' = any(coalesce(profile.role, '{}'::text[]))
      and (
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
    page.customer_name,
    page.city,
    page.created_at,
    page.total_requests,
    page.open_requests,
    page.in_progress_jobs,
    page.completed_jobs
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

revoke all on function public.get_admin_customers(
  text,
  text,
  text,
  timestamptz,
  text,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.get_admin_customers(
  text,
  text,
  text,
  timestamptz,
  text,
  uuid,
  integer
) to authenticated;

commit;
