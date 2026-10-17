create schema repair_image_private authorization postgres;

revoke all on schema repair_image_private
  from public, anon, authenticated, service_role;

create table repair_image_private.repair_image_objects (
  bucket_id text not null default 'repair-images',
  object_path text not null,
  owner_user_id uuid not null,
  lifecycle_state text not null default 'discovered',
  origin text not null default 'runtime',
  row_version bigint not null default 1,
  upload_lease_id uuid,
  upload_lease_expires_at timestamptz,
  uploaded_at timestamptz,
  first_observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_observed_at timestamptz,
  last_reference_scan_at timestamptz,
  consecutive_unreferenced_scans integer not null default 0,
  unreferenced_since timestamptz,
  tombstoned_at timestamptz,
  tombstone_reason text,
  delete_claim_id uuid,
  delete_lease_expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (bucket_id, object_path),
  constraint repair_image_objects_bucket_check
    check (bucket_id = 'repair-images'),
  constraint repair_image_objects_path_check
    check (
      object_path ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9][A-Za-z0-9._-]*$'
      and pg_catalog.char_length(object_path) <= 1024
      and pg_catalog.strpos(object_path, '//') = 0
      and pg_catalog.strpos(object_path, pg_catalog.chr(92)) = 0
      and pg_catalog.strpos(object_path, '?') = 0
      and pg_catalog.strpos(object_path, '#') = 0
      and pg_catalog.strpos(object_path, '%') = 0
    ),
  constraint repair_image_objects_path_owner_check
    check (
      pg_catalog.lower(pg_catalog.split_part(object_path, '/', 1)) =
      pg_catalog.lower(owner_user_id::text)
    ),
  constraint repair_image_objects_state_check
    check (
      lifecycle_state in (
        'discovered',
        'reserved',
        'uploaded',
        'attached',
        'orphan_candidate',
        'tombstoned',
        'delete_claimed',
        'deleted',
        'quarantined'
      )
    ),
  constraint repair_image_objects_origin_check
    check (origin in ('runtime', 'legacy_import', 'reconciliation')),
  constraint repair_image_objects_version_check
    check (row_version > 0),
  constraint repair_image_objects_scan_count_check
    check (consecutive_unreferenced_scans >= 0),
  constraint repair_image_objects_upload_lease_check
    check (
      (
        lifecycle_state = 'reserved'
        and upload_lease_id is not null
        and upload_lease_expires_at is not null
        and upload_lease_expires_at > created_at
      )
      or (
        lifecycle_state <> 'reserved'
        and upload_lease_id is null
        and upload_lease_expires_at is null
      )
    ),
  constraint repair_image_objects_orphan_candidate_check
    check (
      lifecycle_state <> 'orphan_candidate'
      or (
        unreferenced_since is not null
        and last_reference_scan_at is not null
        and consecutive_unreferenced_scans >= 2
        and last_reference_scan_at >= unreferenced_since + interval '24 hours'
      )
    ),
  constraint repair_image_objects_tombstone_check
    check (
      (
        lifecycle_state in ('tombstoned', 'delete_claimed', 'deleted')
        and tombstoned_at is not null
        and tombstone_reason is not null
        and pg_catalog.btrim(tombstone_reason) <> ''
      )
      or (
        lifecycle_state not in ('tombstoned', 'delete_claimed', 'deleted')
        and tombstoned_at is null
        and tombstone_reason is null
      )
    ),
  constraint repair_image_objects_delete_claim_check
    check (
      (
        lifecycle_state = 'delete_claimed'
        and delete_claim_id is not null
        and delete_lease_expires_at is not null
        and delete_lease_expires_at > tombstoned_at
      )
      or (
        lifecycle_state <> 'delete_claimed'
        and delete_claim_id is null
        and delete_lease_expires_at is null
      )
    ),
  constraint repair_image_objects_deleted_check
    check (
      (lifecycle_state = 'deleted' and deleted_at is not null)
      or (lifecycle_state <> 'deleted' and deleted_at is null)
    )
);

comment on table repair_image_private.repair_image_objects is
  'Private lifecycle registry for repair-images objects. Rows and paths are retained after deletion to prevent path reuse.';
comment on column repair_image_private.repair_image_objects.owner_user_id is
  'Application owner asserted by trusted registry operations; storage.objects.owner_id is not an authorization source.';
comment on column repair_image_private.repair_image_objects.row_version is
  'Monotonic value for optimistic checks in future reservation and cleanup operations.';
comment on column repair_image_private.repair_image_objects.lifecycle_state is
  'discovered imports are non-deletable inventory until explicitly classified by future trusted procedures.';

create table repair_image_private.repair_image_object_references (
  bucket_id text not null,
  object_path text not null,
  reference_type text not null default 'repair_request_image',
  reference_id uuid not null,
  first_seen_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_verified_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (bucket_id, object_path, reference_type, reference_id),
  constraint repair_image_object_references_object_fkey
    foreign key (bucket_id, object_path)
    references repair_image_private.repair_image_objects (bucket_id, object_path)
    on update restrict
    on delete restrict,
  constraint repair_image_object_references_type_check
    check (reference_type = 'repair_request_image'),
  constraint repair_image_object_references_bucket_check
    check (bucket_id = 'repair-images')
);

comment on table repair_image_private.repair_image_object_references is
  'Private normalized active-reference set. Future trusted synchronization must verify reference_id against repair_requests under lock.';
comment on column repair_image_private.repair_image_object_references.reference_id is
  'Repair request identifier. No business-table foreign key is added in this stage to avoid business-table triggers or cascade behavior.';

create index repair_image_objects_owner_state_idx
  on repair_image_private.repair_image_objects (owner_user_id, lifecycle_state);

create index repair_image_objects_orphan_scan_idx
  on repair_image_private.repair_image_objects (
    lifecycle_state,
    unreferenced_since,
    last_reference_scan_at
  )
  where lifecycle_state in ('uploaded', 'orphan_candidate');

create index repair_image_objects_delete_lease_idx
  on repair_image_private.repair_image_objects (lifecycle_state, delete_lease_expires_at)
  where lifecycle_state = 'delete_claimed';

create index repair_image_object_references_request_idx
  on repair_image_private.repair_image_object_references (reference_type, reference_id);

create function repair_image_private.guard_repair_image_object_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.lifecycle_state not in ('discovered', 'reserved') then
    raise exception using
      errcode = '23514',
      message = 'A repair image registry row must start as discovered or reserved.';
  end if;

  return new;
end;
$function$;

create function repair_image_private.prevent_repair_image_object_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '23514',
    message = 'Repair image registry objects cannot be physically deleted.';

  return old;
end;
$function$;

comment on function repair_image_private.prevent_repair_image_object_delete() is
  'Rejects physical deletion with SQLSTATE 23514 so registry paths remain permanently reserved.';

create function repair_image_private.enforce_repair_image_object_transition()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  transition_allowed boolean;
begin
  if old.lifecycle_state = 'deleted' then
    raise exception using
      errcode = '23514',
      message = 'A deleted repair image registry row is immutable.';
  end if;

  if new.bucket_id is distinct from old.bucket_id
    or new.object_path is distinct from old.object_path
    or new.owner_user_id is distinct from old.owner_user_id
    or new.origin is distinct from old.origin
    or new.first_observed_at is distinct from old.first_observed_at
    or new.created_at is distinct from old.created_at
  then
    raise exception using
      errcode = '23514',
      message = 'Repair image registry identity is immutable.';
  end if;

  transition_allowed := case old.lifecycle_state
    when 'discovered' then
      new.lifecycle_state in (
        'discovered',
        'uploaded',
        'attached',
        'orphan_candidate',
        'quarantined'
      )
    when 'reserved' then
      new.lifecycle_state in ('reserved', 'uploaded', 'quarantined')
    when 'uploaded' then
      new.lifecycle_state in (
        'uploaded',
        'attached',
        'orphan_candidate',
        'tombstoned',
        'quarantined'
      )
    when 'attached' then
      new.lifecycle_state in (
        'attached',
        'orphan_candidate',
        'tombstoned',
        'quarantined'
      )
    when 'orphan_candidate' then
      new.lifecycle_state in (
        'orphan_candidate',
        'attached',
        'tombstoned',
        'quarantined'
      )
    when 'tombstoned' then
      new.lifecycle_state in ('tombstoned', 'delete_claimed', 'quarantined')
    when 'delete_claimed' then
      new.lifecycle_state in (
        'delete_claimed',
        'tombstoned',
        'deleted',
        'quarantined'
      )
    when 'deleted' then
      new.lifecycle_state = 'deleted'
    when 'quarantined' then
      new.lifecycle_state = 'quarantined'
    else false
  end;

  if transition_allowed is distinct from true then
    raise exception using
      errcode = '23514',
      message = 'Repair image registry state transition is not allowed.';
  end if;

  if new.lifecycle_state in (
    'orphan_candidate',
    'tombstoned',
    'delete_claimed',
    'deleted'
  )
    and exists (
      select 1
      from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = old.bucket_id
        and reference.object_path = old.object_path
    )
  then
    raise exception using
      errcode = '23514',
      message = 'A referenced repair image cannot enter an unreferenced or deletion state.';
  end if;

  if new.lifecycle_state = 'attached'
    and not exists (
      select 1
      from repair_image_private.repair_image_object_references reference
      where reference.bucket_id = old.bucket_id
        and reference.object_path = old.object_path
    )
  then
    raise exception using
      errcode = '23514',
      message = 'An attached repair image must have an active reference.';
  end if;

  new.row_version := old.row_version + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

create function repair_image_private.guard_repair_image_reference_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_bucket_id text;
  target_object_path text;
  object_state text;
begin
  if tg_op = 'UPDATE'
    and (
      new.bucket_id is distinct from old.bucket_id
      or new.object_path is distinct from old.object_path
      or new.reference_type is distinct from old.reference_type
      or new.reference_id is distinct from old.reference_id
      or new.first_seen_at is distinct from old.first_seen_at
      or new.created_at is distinct from old.created_at
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Repair image registry reference identity is immutable.';
  end if;

  target_bucket_id := case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end;
  target_object_path := case when tg_op = 'DELETE' then old.object_path else new.object_path end;

  select registry.lifecycle_state
  into object_state
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = target_bucket_id
    and registry.object_path = target_object_path
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Repair image registry object does not exist.';
  end if;

  if tg_op = 'INSERT'
    and object_state not in (
      'discovered',
      'uploaded',
      'attached',
      'orphan_candidate'
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Repair image registry object cannot accept references.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create function repair_image_private.enforce_repair_image_reference_consistency()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  target_bucket_id text;
  target_object_path text;
  current_lifecycle_state text;
  has_active_references boolean;
begin
  /*
   * Constraint triggers run after the row event and may be deferred until the
   * end of the transaction. Always re-read both tables so every queued event
   * validates the final transaction state rather than its intermediate NEW or
   * OLD values. The immediate reference guard already serializes reference
   * mutations by locking the parent object row; this final check deliberately
   * takes no additional row locks and therefore does not invert that order.
   */
  if tg_table_name = 'repair_image_objects' then
    target_bucket_id := case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end;
    target_object_path := case when tg_op = 'DELETE' then old.object_path else new.object_path end;
  elsif tg_table_name = 'repair_image_object_references' then
    target_bucket_id := case when tg_op = 'DELETE' then old.bucket_id else new.bucket_id end;
    target_object_path := case when tg_op = 'DELETE' then old.object_path else new.object_path end;
  else
    raise exception using
      errcode = '23514',
      message = 'Unexpected repair image registry consistency trigger source.';
  end if;

  select registry.lifecycle_state
  into current_lifecycle_state
  from repair_image_private.repair_image_objects registry
  where registry.bucket_id = target_bucket_id
    and registry.object_path = target_object_path;

  select exists (
    select 1
    from repair_image_private.repair_image_object_references reference
    where reference.bucket_id = target_bucket_id
      and reference.object_path = target_object_path
  )
  into has_active_references;

  if current_lifecycle_state is null then
    if has_active_references then
      raise exception using
        errcode = '23514',
        message = 'A repair image reference must have a registry object.';
    end if;

    return null;
  end if;

  if current_lifecycle_state = 'attached'
    and has_active_references is distinct from true
  then
    raise exception using
      errcode = '23514',
      message = 'An attached repair image must have an active reference at transaction end.';
  end if;

  if has_active_references
    and current_lifecycle_state is distinct from 'attached'
  then
    raise exception using
      errcode = '23514',
      message = 'A referenced repair image must be attached at transaction end.';
  end if;

  return null;
end;
$function$;

create trigger guard_repair_image_object_insert
before insert on repair_image_private.repair_image_objects
for each row
execute function repair_image_private.guard_repair_image_object_insert();

create trigger prevent_repair_image_object_delete
before delete on repair_image_private.repair_image_objects
for each row
execute function repair_image_private.prevent_repair_image_object_delete();

create trigger enforce_repair_image_object_transition
before update on repair_image_private.repair_image_objects
for each row
execute function repair_image_private.enforce_repair_image_object_transition();

create trigger guard_repair_image_reference_mutation
before insert or update or delete on repair_image_private.repair_image_object_references
for each row
execute function repair_image_private.guard_repair_image_reference_mutation();

create constraint trigger enforce_repair_image_object_consistency
after insert or update or delete on repair_image_private.repair_image_objects
deferrable initially deferred
for each row
execute function repair_image_private.enforce_repair_image_reference_consistency();

create constraint trigger enforce_repair_image_reference_consistency
after insert or update or delete on repair_image_private.repair_image_object_references
deferrable initially deferred
for each row
execute function repair_image_private.enforce_repair_image_reference_consistency();

alter table repair_image_private.repair_image_objects enable row level security;
alter table repair_image_private.repair_image_objects force row level security;
alter table repair_image_private.repair_image_object_references enable row level security;
alter table repair_image_private.repair_image_object_references force row level security;

alter table repair_image_private.repair_image_objects owner to postgres;
alter table repair_image_private.repair_image_object_references owner to postgres;
alter function repair_image_private.guard_repair_image_object_insert() owner to postgres;
alter function repair_image_private.prevent_repair_image_object_delete() owner to postgres;
alter function repair_image_private.enforce_repair_image_object_transition() owner to postgres;
alter function repair_image_private.guard_repair_image_reference_mutation() owner to postgres;
alter function repair_image_private.enforce_repair_image_reference_consistency() owner to postgres;

revoke all on table repair_image_private.repair_image_objects
  from public, anon, authenticated, service_role;
revoke all on table repair_image_private.repair_image_object_references
  from public, anon, authenticated, service_role;
revoke all on function repair_image_private.guard_repair_image_object_insert()
  from public, anon, authenticated, service_role;
revoke all on function repair_image_private.prevent_repair_image_object_delete()
  from public, anon, authenticated, service_role;
revoke all on function repair_image_private.enforce_repair_image_object_transition()
  from public, anon, authenticated, service_role;
revoke all on function repair_image_private.guard_repair_image_reference_mutation()
  from public, anon, authenticated, service_role;
revoke all on function repair_image_private.enforce_repair_image_reference_consistency()
  from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema repair_image_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema repair_image_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema repair_image_private
  revoke all on functions from public, anon, authenticated, service_role;
/*
 * Runtime constraint and transition tests live in:
 * supabase/tests/repair_image_registry_test.sql
 *
 * They are intentionally excluded from the production migration so applying
 * this migration never creates synthetic registry rows.
 */
