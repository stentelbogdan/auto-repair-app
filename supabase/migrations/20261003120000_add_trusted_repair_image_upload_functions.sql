create or replace function public.reserve_repair_image_upload(
  p_file_extension text
)
returns table (
  object_path text,
  upload_lease_id uuid,
  upload_lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  normalized_extension text := pg_catalog.lower(
    pg_catalog.btrim(p_file_extension)
  );
  reservation_attempt integer;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if normalized_extension is null
    or normalized_extension not in ('jpg', 'png', 'webp')
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid repair image file extension.';
  end if;

  for reservation_attempt in 1..5 loop
    object_path := current_user_id::text
      || '/'
      || pg_catalog.gen_random_uuid()::text
      || '.'
      || normalized_extension;
    upload_lease_id := pg_catalog.gen_random_uuid();
    upload_lease_expires_at := pg_catalog.clock_timestamp()
      + interval '15 minutes';

    begin
      insert into repair_image_private.repair_image_objects (
        bucket_id,
        object_path,
        owner_user_id,
        lifecycle_state,
        origin,
        upload_lease_id,
        upload_lease_expires_at
      ) values (
        'repair-images',
        object_path,
        current_user_id,
        'reserved',
        'runtime',
        upload_lease_id,
        upload_lease_expires_at
      );

      return next;
      return;
    exception
      when unique_violation then
        -- A retained registry path is never reused. Generate a fresh path.
        null;
    end;
  end loop;

  raise exception using
    errcode = '55000',
    message = 'Could not reserve a unique repair image path.';
end;
$function$;

create or replace function public.can_upload_reserved_repair_image(
  p_object_path text
)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from repair_image_private.repair_image_objects registry
      where registry.bucket_id = 'repair-images'
        and registry.object_path = p_object_path
        and registry.owner_user_id = auth.uid()
        and registry.lifecycle_state = 'reserved'
        and registry.upload_lease_id is not null
        and registry.upload_lease_expires_at > pg_catalog.clock_timestamp()
    );
$function$;

create or replace function public.confirm_repair_image_upload(
  p_object_path text,
  p_upload_lease_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  locked_object repair_image_private.repair_image_objects%rowtype;
  storage_owner_id text;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if p_object_path is null
    or p_object_path = ''
    or p_upload_lease_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid repair image upload confirmation.';
  end if;

  select registry.*
  into locked_object
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = 'repair-images'
    and registry.object_path = p_object_path
  for update;

  if not found
    or locked_object.owner_user_id is distinct from current_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'Repair image upload reservation not found.';
  end if;

  if locked_object.lifecycle_state not in ('reserved', 'uploaded', 'attached') then
    raise exception using
      errcode = '42501',
      message = 'Repair image upload reservation not found.';
  end if;

  if locked_object.lifecycle_state = 'reserved'
    and locked_object.upload_lease_id is distinct from p_upload_lease_id
  then
    raise exception using
      errcode = '42501',
      message = 'Repair image upload reservation not found.';
  end if;

  select storage_object.owner_id
  into storage_owner_id
  from storage.objects storage_object
  where storage_object.bucket_id = 'repair-images'
    and storage_object.name = p_object_path;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Repair image upload is not present in Storage.';
  end if;

  if storage_owner_id is distinct from current_user_id::text then
    raise exception using
      errcode = '42501',
      message = 'Repair image Storage ownership does not match the reservation.';
  end if;

  if locked_object.lifecycle_state in ('uploaded', 'attached') then
    /*
     * The registry constraint clears the lease after the first confirmation.
     * A retry is therefore keyed by the authenticated owner and retained path,
     * while Storage existence and ownership are verified again above.
     */
    return locked_object.lifecycle_state;
  end if;

  /*
   * An expired lease cannot authorize a new Storage INSERT because the future
   * Storage policy uses can_upload_reserved_repair_image(). Confirmation is
   * still allowed while the exact reserved row and lease remain present so a
   * completed upload can recover from a lost or delayed client response.
   */
  update repair_image_private.repair_image_objects registry
  set
    lifecycle_state = 'uploaded',
    upload_lease_id = null,
    upload_lease_expires_at = null,
    uploaded_at = pg_catalog.clock_timestamp(),
    last_observed_at = pg_catalog.clock_timestamp()
  where registry.bucket_id = 'repair-images'
    and registry.object_path = p_object_path;

  return 'uploaded';
end;
$function$;

create or replace function public.abandon_repair_image_upload(
  p_object_path text,
  p_upload_lease_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  locked_object repair_image_private.repair_image_objects%rowtype;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if p_object_path is null
    or p_object_path = ''
    or p_upload_lease_id is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid repair image upload abandonment.';
  end if;

  select registry.*
  into locked_object
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = 'repair-images'
    and registry.object_path = p_object_path
  for update;

  if not found
    or locked_object.owner_user_id is distinct from current_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'Repair image upload reservation not found.';
  end if;

  if locked_object.lifecycle_state is distinct from 'reserved'
    or locked_object.upload_lease_id is distinct from p_upload_lease_id
  then
    raise exception using
      errcode = '42501',
      message = 'Repair image upload reservation not found.';
  end if;

  /*
   * This is a logical abandonment only. Supabase Storage authorization and
   * the HTTP object transfer are not one PostgreSQL transaction, so the
   * absence of visible metadata cannot prove that an authorized upload will
   * not finish later. Keep the reservation and its original lease intact so
   * a delayed upload can still be confirmed. Future reconciliation may
   * classify expired reservations after its independent safety checks.
   */
  return 'reserved';
end;
$function$;

alter function public.reserve_repair_image_upload(text) owner to postgres;
alter function public.can_upload_reserved_repair_image(text) owner to postgres;
alter function public.confirm_repair_image_upload(text, uuid) owner to postgres;
alter function public.abandon_repair_image_upload(text, uuid) owner to postgres;

revoke all on function public.reserve_repair_image_upload(text)
  from public, anon, authenticated, service_role;
revoke all on function public.can_upload_reserved_repair_image(text)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_repair_image_upload(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.abandon_repair_image_upload(text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.reserve_repair_image_upload(text)
  to authenticated;
grant execute on function public.can_upload_reserved_repair_image(text)
  to authenticated;
grant execute on function public.confirm_repair_image_upload(text, uuid)
  to authenticated;
grant execute on function public.abandon_repair_image_upload(text, uuid)
  to authenticated;

comment on function public.reserve_repair_image_upload(text) is
  'Reserves a server-generated repair-images path for the authenticated owner.';
comment on function public.can_upload_reserved_repair_image(text) is
  'Returns whether the authenticated owner has a live upload reservation for a path.';
comment on function public.confirm_repair_image_upload(text, uuid) is
  'Confirms a reserved repair image after verifying the exact Storage object and owner.';
comment on function public.abandon_repair_image_upload(text, uuid) is
  'Records logical abandonment by validating the reservation without changing its state or cancelling an in-flight HTTP upload.';
