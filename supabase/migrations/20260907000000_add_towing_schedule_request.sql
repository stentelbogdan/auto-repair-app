alter table public.repair_requests
  add column towing_schedule_type text null,
  add column towing_requested_at timestamptz null,
  add column towing_requested_timezone text null;

alter table public.repair_requests
  add constraint repair_requests_towing_schedule_type_check
  check (
    towing_schedule_type is null
    or towing_schedule_type in ('asap', 'scheduled')
  ),
  add constraint repair_requests_towing_schedule_consistency_check
  check (
    (
      towing_schedule_type is null
      and towing_requested_at is null
      and towing_requested_timezone is null
    )
    or (
      towing_schedule_type = 'asap'
      and towing_requested_at is null
      and towing_requested_timezone is null
    )
    or (
      towing_schedule_type = 'scheduled'
      and towing_requested_at is not null
      and nullif(btrim(towing_requested_timezone), '') is not null
    )
  );
