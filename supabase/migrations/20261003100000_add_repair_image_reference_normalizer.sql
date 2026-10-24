create or replace function public.normalize_repair_image_storage_reference(
  p_reference text,
  p_reference_kind text,
  p_expected_host text
)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  normalized_kind text := pg_catalog.lower(pg_catalog.btrim(p_reference_kind));
  expected_host text := pg_catalog.lower(pg_catalog.btrim(p_expected_host));
  cleaned_reference text;
  reference_without_query text;
  reference_after_scheme text;
  reference_authority text;
  reference_host text;
  reference_path text;
  https_scheme constant text := 'https://';
  public_bucket_prefix constant text := '/storage/v1/object/public/repair-images/';
  raw_bucket_prefix constant text := 'repair-images/';
begin
  if expected_host is null
    or expected_host !~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$'
    or pg_catalog.strpos(expected_host, '..') > 0
  then
    raise exception using
      errcode = '22023',
      message = 'Expected Storage host is invalid.';
  end if;

  if normalized_kind is null
    or normalized_kind not in ('path', 'url', 'string')
  then
    raise exception using
      errcode = '22023',
      message = 'Repair image reference kind is invalid.';
  end if;

  if p_reference is null or p_reference = '' then
    raise exception using
      errcode = '22023',
      message = 'Repair image reference is empty.';
  end if;

  if p_reference is distinct from pg_catalog.btrim(p_reference) then
    raise exception using
      errcode = '22023',
      message = 'Repair image reference contains surrounding whitespace.';
  end if;

  cleaned_reference := p_reference;

  if cleaned_reference ~* '^data:' then
    return null;
  end if;

  if normalized_kind = 'string' then
    normalized_kind := case
      when cleaned_reference ~* '^https://' then 'url'
      else 'path'
    end;
  end if;

  if normalized_kind = 'url' then
    if cleaned_reference !~* '^https://' then
      raise exception using
        errcode = '22023',
        message = 'Repair image URL must use HTTPS.';
    end if;

    if pg_catalog.strpos(cleaned_reference, '#') > 0 then
      raise exception using
        errcode = '22023',
        message = 'Repair image URL fragments are not supported.';
    end if;

    reference_without_query := pg_catalog.split_part(cleaned_reference, '?', 1);
    reference_after_scheme := pg_catalog.substr(
      reference_without_query,
      pg_catalog.char_length(https_scheme) + 1
    );
    reference_authority := pg_catalog.split_part(
      reference_after_scheme,
      '/',
      1
    );
    reference_host := pg_catalog.lower(reference_authority);

    if reference_host is distinct from expected_host then
      raise exception using
        errcode = '22023',
        message = 'Repair image URL host is not allowed.';
    end if;

    reference_path := pg_catalog.substr(
      reference_after_scheme,
      pg_catalog.char_length(reference_authority) + 1
    );

    if pg_catalog.left(
      reference_path,
      pg_catalog.char_length(public_bucket_prefix)
    ) is distinct from public_bucket_prefix then
      raise exception using
        errcode = '22023',
        message = 'Repair image URL bucket or endpoint is not allowed.';
    end if;

    reference_path := pg_catalog.substr(
      reference_path,
      pg_catalog.char_length(public_bucket_prefix) + 1
    );
  else
    if cleaned_reference ~* '^[a-z][a-z0-9+.-]*:' then
      raise exception using
        errcode = '22023',
        message = 'Repair image path must not contain a URL scheme.';
    end if;

    if pg_catalog.left(
      cleaned_reference,
      pg_catalog.char_length(raw_bucket_prefix)
    ) = raw_bucket_prefix then
      reference_path := pg_catalog.substr(
        cleaned_reference,
        pg_catalog.char_length(raw_bucket_prefix) + 1
      );
    else
      reference_path := cleaned_reference;
    end if;
  end if;

  reference_path := pg_catalog.regexp_replace(
    reference_path,
    '%2f',
    '/',
    'gi'
  );

  if reference_path = ''
    or pg_catalog.char_length(reference_path) > 1024
    or pg_catalog.left(reference_path, 1) = '/'
    or pg_catalog.right(reference_path, 1) = '/'
    or pg_catalog.strpos(reference_path, '//') > 0
    or pg_catalog.strpos(reference_path, pg_catalog.chr(92)) > 0
    or pg_catalog.strpos(reference_path, '?') > 0
    or pg_catalog.strpos(reference_path, '#') > 0
    or pg_catalog.strpos(reference_path, '%') > 0
    or reference_path ~ '(^|/)[.][.](/|$)'
    or reference_path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]*$'
  then
    raise exception using
      errcode = '22023',
      message = 'Repair image Storage path is invalid or ambiguous.';
  end if;

  return reference_path;
end;
$function$;

create or replace function public.extract_repair_image_storage_references(
  p_images jsonb,
  p_expected_host text
)
returns table (
  image_index bigint,
  object_path text,
  reference_format text
)
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  normalized_images jsonb;
  image_record record;
  path_reference text;
  url_reference text;
  normalized_path_reference text;
  normalized_url_reference text;
begin
  if p_images is null or p_images = 'null'::jsonb then
    return;
  end if;

  normalized_images := case pg_catalog.jsonb_typeof(p_images)
    when 'array' then p_images
    when 'object' then pg_catalog.jsonb_build_array(p_images)
    when 'string' then pg_catalog.jsonb_build_array(p_images)
    else null
  end;

  if normalized_images is null then
    raise exception using
      errcode = '22023',
      message = 'Repair request images must be an array, object, string, or null.';
  end if;

  for image_record in
    select image_item.value, image_item.ordinality
    from pg_catalog.jsonb_array_elements(normalized_images)
      with ordinality as image_item(value, ordinality)
  loop
    path_reference := null;
    url_reference := null;
    normalized_path_reference := null;
    normalized_url_reference := null;

    if pg_catalog.jsonb_typeof(image_record.value) = 'string' then
      object_path := public.normalize_repair_image_storage_reference(
        image_record.value #>> '{}',
        'string',
        p_expected_host
      );

      if object_path is null then
        continue;
      end if;

      image_index := image_record.ordinality;
      reference_format := case
        when (image_record.value #>> '{}') ~* '^https://'
          then 'legacy_url_string'
        else 'path_string'
      end;
      return next;
      continue;
    end if;

    if pg_catalog.jsonb_typeof(image_record.value) is distinct from 'object' then
      raise exception using
        errcode = '22023',
        message = 'Repair image array contains an unsupported value.';
    end if;

    path_reference := image_record.value ->> 'path';
    url_reference := image_record.value ->> 'url';

    if path_reference is not null then
      normalized_path_reference := public.normalize_repair_image_storage_reference(
        path_reference,
        'path',
        p_expected_host
      );
    end if;

    if url_reference is not null then
      normalized_url_reference := public.normalize_repair_image_storage_reference(
        url_reference,
        'url',
        p_expected_host
      );
    end if;

    if normalized_path_reference is not null
      and normalized_url_reference is not null
      and normalized_path_reference is distinct from normalized_url_reference
    then
      raise exception using
        errcode = '22023',
        message = 'Repair image path and URL identify different Storage objects.';
    end if;

    object_path := coalesce(
      normalized_path_reference,
      normalized_url_reference
    );

    if object_path is null then
      if pg_catalog.jsonb_exists(image_record.value, 'dataUrl')
        or pg_catalog.jsonb_exists(image_record.value, 'data_url')
      then
        continue;
      end if;

      raise exception using
        errcode = '22023',
        message = 'Repair image object has no supported Storage reference.';
    end if;

    image_index := image_record.ordinality;
    reference_format := case
      when normalized_path_reference is not null
        and normalized_url_reference is not null
        then 'current_path_and_url'
      when normalized_path_reference is not null
        then 'path_only'
      else 'legacy_url_only'
    end;
    return next;
  end loop;
end;
$function$;

do $tests$
declare
  expected_host constant text := 'project.supabase.co';
  expected_path constant text :=
    '11111111-1111-4111-8111-111111111111/1700000000000-test.jpg';
  actual_path text;
  extracted_paths text[];
  extracted_formats text[];
  extracted_count bigint;
  rejected boolean;
begin
  actual_path := public.normalize_repair_image_storage_reference(
    expected_path,
    'path',
    expected_host
  );
  if actual_path is distinct from expected_path then
    raise exception 'Direct path normalization test failed.';
  end if;

  actual_path := public.normalize_repair_image_storage_reference(
    'repair-images/' || expected_path,
    'path',
    expected_host
  );
  if actual_path is distinct from expected_path then
    raise exception 'Bucket-prefixed path normalization test failed.';
  end if;

  actual_path := public.normalize_repair_image_storage_reference(
    'https://project.supabase.co/storage/v1/object/public/repair-images/'
      || expected_path,
    'url',
    expected_host
  );
  if actual_path is distinct from expected_path then
    raise exception 'Legacy public URL normalization test failed.';
  end if;

  actual_path := public.normalize_repair_image_storage_reference(
    'https://project.supabase.co/storage/v1/object/public/repair-images/'
      || expected_path || '?download=1&token=test',
    'url',
    expected_host
  );
  if actual_path is distinct from expected_path then
    raise exception 'URL query-string normalization test failed.';
  end if;

  actual_path := public.normalize_repair_image_storage_reference(
    'https://project.supabase.co/storage/v1/object/public/repair-images/'
      || '11111111-1111-4111-8111-111111111111%2F1700000000000-test.jpg',
    'url',
    expected_host
  );
  if actual_path is distinct from expected_path then
    raise exception 'Encoded slash normalization test failed.';
  end if;

  select
    pg_catalog.array_agg(reference.object_path order by reference.image_index),
    pg_catalog.array_agg(reference.reference_format order by reference.image_index)
  into extracted_paths, extracted_formats
  from public.extract_repair_image_storage_references(
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', 'current.jpg',
        'path', expected_path,
        'url',
          'https://project.supabase.co/storage/v1/object/public/repair-images/'
            || expected_path,
        'fingerprint', pg_catalog.repeat('a', 64),
        'fingerprintVersion', 'sha256-prepared-v1'
      ),
      pg_catalog.jsonb_build_object(
        'name', 'legacy.jpg',
        'url',
          'https://project.supabase.co/storage/v1/object/public/repair-images/'
            || '22222222-2222-4222-8222-222222222222/legacy.jpg'
      )
    ),
    expected_host
  ) as reference;

  if extracted_paths is distinct from array[
    expected_path,
    '22222222-2222-4222-8222-222222222222/legacy.jpg'
  ]::text[] then
    raise exception 'Current and legacy extraction test failed.';
  end if;

  if extracted_formats is distinct from array[
    'current_path_and_url',
    'legacy_url_only'
  ]::text[] then
    raise exception 'Reference format classification test failed.';
  end if;

  select pg_catalog.count(*)
  into extracted_count
  from public.extract_repair_image_storage_references(
    '[{"name":"embedded.jpg","dataUrl":"data:image/jpeg;base64,AA=="}]'::jsonb,
    expected_host
  );

  if extracted_count is distinct from 0 then
    raise exception 'Embedded data URL ignore test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      expected_path,
      null,
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Null reference kind rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      'https://other.example/storage/v1/object/public/repair-images/'
        || expected_path,
      'url',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Foreign host rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      'https://project.supabase.co/storage/v1/object/public/chat-images/'
        || expected_path,
      'url',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Foreign bucket rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      '11111111-1111-4111-8111-111111111111/../other.jpg',
      'path',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Path traversal rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      '11111111-1111-4111-8111-111111111111/file%20name.jpg',
      'path',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Ambiguous percent-encoding rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.extract_repair_image_storage_references(
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'path', expected_path,
          'url',
            'https://project.supabase.co/storage/v1/object/public/repair-images/'
              || '33333333-3333-4333-8333-333333333333/different.jpg'
        )
      ),
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Path and URL mismatch rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      'https://project.supabase.co:443/storage/v1/object/public/repair-images/'
        || expected_path,
      'url',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'URL port rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      'https://project.supabase.co.evil.example/storage/v1/object/public/repair-images/'
        || expected_path,
      'url',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Ambiguous host suffix rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      'https://project.supabase.co@evil.example/storage/v1/object/public/repair-images/'
        || expected_path,
      'url',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Ambiguous userinfo host rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      'http://project.supabase.co/storage/v1/object/public/repair-images/'
        || expected_path,
      'url',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Invalid URL scheme rejection test failed.';
  end if;

  rejected := false;
  begin
    perform public.normalize_repair_image_storage_reference(
      '11111111-1111-4111-8111-111111111111/file name.jpg',
      'path',
      expected_host
    );
  exception
    when sqlstate '22023' then rejected := true;
  end;
  if not rejected then
    raise exception 'Invalid path character rejection test failed.';
  end if;
end;
$tests$;

alter function public.normalize_repair_image_storage_reference(text, text, text)
  owner to postgres;

alter function public.extract_repair_image_storage_references(jsonb, text)
  owner to postgres;

revoke all on function public.normalize_repair_image_storage_reference(text, text, text)
  from public, anon, authenticated;

revoke all on function public.extract_repair_image_storage_references(jsonb, text)
  from public, anon, authenticated;
